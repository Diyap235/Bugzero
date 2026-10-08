"use client";

import Link from "next/link";
import { Suspense, useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { Metric, PageHeading, ResourceState, StatusLabel, UnknownValue, formatTimestamp } from "@/components/product/ui";
import { useApiResource } from "@/hooks/useApiResource";
import { bugzeroApi } from "@/lib/api-client";
import { sampleHealthHistory, sampleRepository } from "@/domains/product/sample-data";

const sampleHealthData = [{ repository: sampleRepository, history: sampleHealthHistory }];

function HealthContent() {
  const params = useSearchParams();
  const queryRepositoryId = params.get("repositoryId") ?? "";
  const [selectedId, setSelectedId] = useState("");
  const load = useCallback(async () => {
    const repositories = await bugzeroApi.listRepositories();
    const data = await Promise.all(repositories.map(async (repository) => ({
      repository,
      history: await bugzeroApi.getHealthHistory(repository.id),
    })));
    return data.some(({ history }) => history.length > 0) ? data : [];
  }, []);
  const resource = useApiResource(load, sampleHealthData);
  const all = resource.data ?? sampleHealthData;
  const selection = selectedId || queryRepositoryId || all[0]?.repository.id || "";
  const current = useMemo(() => all.find(({ repository }) => repository.id === selection), [all, selection]);
  const snapshots = current?.history ?? [];
  const latest = snapshots[0]?.snapshot;
  const dimensions = latest?.dimensions;
  const dimensionNames = ["security", "quality", "maintainability", "reliability", "dependencies"] as const;
  const supported = dimensionNames.filter((name) => dimensions?.[name]?.score !== null && dimensions?.[name]?.score !== undefined);
  const unknown = dimensionNames.filter((name) => dimensions?.[name]?.score == null);

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeading eyebrow="Deterministic repository health" title="Repository health" description="Scores and coverage are read from immutable health snapshots. Unknown dimensions are not treated as zero." />
        <ResourceState loading={resource.loading} error={resource.error} empty={all.length === 0} retry={resource.refresh} sample={resource.isFallback} emptyTitle="No repositories are available" />
        {(!resource.error || resource.isFallback) && all.length > 0 && (
          <>
            <label className="block max-w-lg text-[10px] uppercase tracking-wide text-text-muted">Repository<select value={selection} onChange={(event) => setSelectedId(event.target.value)} className="mt-1 block h-10 w-full rounded-lg border border-border bg-card px-3 text-sm text-white">{all.map(({ repository }) => <option key={repository.id} value={repository.id}>{repository.fullName}</option>)}</select></label>
            {!latest ? <section className="rounded-xl border border-border bg-card p-6"><h2 className="text-sm font-semibold text-white">No health snapshot</h2><p className="mt-2 text-sm text-text-muted">No persisted health assessment is available for this repository.</p><Link href={current ? `/repositories/${current.repository.id}` : "/repositories"} className="mt-4 inline-block text-xs text-primary hover:underline">Open repository →</Link></section> : (
              <>
                <section className="rounded-xl border border-border bg-card p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0"><p className="truncate text-xs text-text-muted">{current?.repository.fullName}</p><div className="mt-2 flex items-baseline gap-2"><span className="font-mono text-5xl font-semibold text-white">{latest.overall_score ?? "Unknown"}</span>{latest.overall_score !== null && <span className="text-xs text-text-muted">/ 100</span>}</div><p className="mt-2 text-xs text-text-muted">Overall status <StatusLabel value={latest.overall_status ?? "UNKNOWN"} /></p></div>
                    <div className="flex flex-wrap gap-2"><StatusLabel value={latest.coverage ?? "UNKNOWN"} /><StatusLabel value={latest.profile_id ? `${latest.profile_id} v${latest.profile_version}` : "LEGACY SNAPSHOT"} /></div>
                  </div>
                  <p className="mt-4 max-w-4xl text-sm leading-6 text-text-secondary">{latest.explanation ?? "No assessment explanation was recorded."}</p>
                  <p className="mt-2 text-[10px] text-text-muted">Snapshot from {formatTimestamp(latest.created_at)} · Commit {snapshots[0]?.commitSha ?? "unknown"}</p>
                </section>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  {dimensionNames.map((name) => {
                    const dimension = dimensions?.[name];
                    return <section key={name} className="min-w-0 rounded-xl border border-border bg-card p-4">
                      <p className="capitalize text-[11px] font-medium text-text-muted">{name}</p>
                      {dimension?.score === null || !dimension ? <div className="mt-3"><UnknownValue explanation={dimension?.explanation ?? "Dimension details are not present in this snapshot."} /></div> : <p className="mt-3 font-mono text-3xl font-semibold text-white">{dimension.score}</p>}
                      <div className="mt-3"><StatusLabel value={dimension?.coverage ?? "UNKNOWN"} /></div>
                      {dimension && <p className="mt-3 text-[10px] leading-5 text-text-muted">{dimension.explanation}</p>}
                    </section>;
                  })}
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Metric label="Analyzed capabilities" value={supported.length ? supported.join(", ") : "None reported"} detail="Based only on dimensions with persisted scores." />
                  <Metric label="Unknown capabilities" value={unknown.length ? unknown.join(", ") : "None"} detail="Unsupported or unavailable dimensions remain explicitly unknown." />
                  <Metric label="Coverage" value={typeof dimensions?.quality?.inputMetrics.coveragePercent === "number" ? `${dimensions.quality.inputMetrics.coveragePercent}%` : "Unknown"} detail="Analyzed source coverage" />
                </div>
                <section className="overflow-hidden rounded-xl border border-border bg-card">
                  <div className="border-b border-border px-4 py-3"><h2 className="text-sm font-semibold text-white">Health history</h2><p className="mt-1 text-xs text-text-muted">{snapshots.length} persisted snapshots. Score changes compare adjacent returned snapshots only.</p></div>
                  {snapshots.length === 0 ? <p className="px-4 py-8 text-sm text-text-muted">No historical snapshots are available.</p> : (
                    <div className="divide-y divide-border">
                      {snapshots.map(({ snapshot, commitSha }, index) => {
                        const previous = snapshots[index + 1]?.snapshot.overall_score;
                        const score = snapshot.overall_score;
                        const delta = score !== null && previous !== null && previous !== undefined ? score - previous : null;
                        return <div key={snapshot.id} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_140px_100px_100px_100px] sm:items-center">
                          <div className="min-w-0"><p className="truncate font-mono text-xs text-white">{commitSha ?? snapshot.commit_id}</p><p className="mt-1 text-[10px] text-text-muted">{formatTimestamp(snapshot.created_at)}</p></div>
                          <span className="font-mono text-xs text-text-secondary">{score ?? "Unknown"}</span>
                          <span className="text-xs text-text-secondary">{delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta}`}</span>
                          <StatusLabel value={snapshot.coverage ?? "UNKNOWN"} />
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
    </AppShell>
  );
}

export default function HealthPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-background p-8 text-sm text-text-muted">Preparing repository health…</main>}>
      <HealthContent />
    </Suspense>
  );
}
