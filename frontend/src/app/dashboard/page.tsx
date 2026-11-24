"use client";

import Link from "next/link";
import { useCallback } from "react";
import { ArrowRight, GitBranch, Plus } from "lucide-react";
import { PageHeading, ResourceState, StatusLabel, formatTimestamp } from "@/components/product/ui";
import { useApiResource } from "@/hooks/useApiResource";
import { bugzeroApi } from "@/lib/api-client";
import { summarizeDashboard } from "@/lib/dashboard-model";
import type { DashboardRepositoryData } from "@/lib/dashboard-model";
import { sortNewestFirst } from "@/lib/analysis-order";

const DASHBOARD_REQUEST_TIMEOUT_MS = 30_000;
const DASHBOARD_REPOSITORY_BATCH_SIZE = 4;

export default function DashboardPage() {
  const load = useCallback(async () => {
    const repositories = await bugzeroApi.listRepositories();
    const results: DashboardRepositoryData[] = [];

    for (let start = 0; start < repositories.length; start += DASHBOARD_REPOSITORY_BATCH_SIZE) {
      const batch = await Promise.all(repositories.slice(start, start + DASHBOARD_REPOSITORY_BATCH_SIZE).map(async (repository) => {
        const [findings, history] = await Promise.all([
          bugzeroApi.getRepositoryFindings(repository.id, DASHBOARD_REQUEST_TIMEOUT_MS),
          bugzeroApi.getRepositoryHistory(repository.id),
        ]);
        return { repository, findings, history };
      }));
      results.push(...batch);
    }

    return results;
  }, []);
  const resource = useApiResource(load, { key: "dashboard", staleTimeMs: 30_000 });
  const repositories = resource.data ?? [];
  const summary = summarizeDashboard(repositories);

  return (
    <div className="space-y-7">
      <PageHeading
        eyebrow="Workspace overview"
        title="Overview"
        description="A clear view of your repositories, analysis activity, and recorded findings."
        action={
          <Link
            href="/repositories#upload-codebase"
            className="inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-border px-3 text-xs font-medium text-text-secondary transition-colors hover:border-primary hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            <Plus className="h-4 w-4 text-primary" aria-hidden="true" />
            Add repository
          </Link>
        }
      />

      {resource.loading && resource.data === null && (
        <p role="status" className="text-sm text-text-muted">Loading workspace overview…</p>
      )}
      {resource.data === null && resource.error && (
        <ResourceState
          loading={false}
          error={resource.error}
          empty={false}
          retry={resource.refresh}
        />
      )}
      {resource.data !== null && resource.refreshError && (
        <ResourceState
          loading={false}
          error={null}
          refreshError={resource.refreshError}
          empty={false}
          retry={resource.refresh}
        />
      )}

      {resource.data !== null && (
        <>
          <section aria-label="Workspace metrics" className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "Repositories", value: summary.repositoryCount, href: "/repositories" },
              { label: "Analyses", value: summary.analysisCount, href: "/history" },
              { label: "Findings", value: summary.findingCount, href: "/findings" },
              { label: "Resolved findings", value: summary.resolvedFindingCount, href: "/findings" },
            ].map(({ label, value, href }) => (
              <Link
                key={label}
                href={href}
                className="group min-w-0 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                aria-label={`${label}: ${value}`}
              >
                <span className="text-[11px] font-medium uppercase tracking-wide text-text-muted">{label}</span>
                <span className="mt-2 block font-mono text-2xl font-semibold text-white">{value}</span>
                <span className="mt-1 flex items-center justify-between gap-2 text-xs text-text-muted">
                  View {label.toLowerCase()}
                  <ArrowRight className="h-3.5 w-3.5 text-primary transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </span>
              </Link>
            ))}
          </section>

          <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.85fr)]">
            <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
              <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                <div>
                  <h2 className="text-sm font-semibold text-white">Repositories</h2>
                  <p className="mt-1 text-xs text-text-muted">Your organization’s connected codebases.</p>
                </div>
                <Link href="/repositories" className="shrink-0 text-xs font-medium text-primary hover:text-white">
                  View all
                </Link>
              </div>
              {repositories.length === 0 ? (
                <div className="px-5 py-8">
                  <p className="text-sm font-medium text-white">No repositories yet</p>
                  <p className="mt-1 max-w-md text-sm leading-6 text-text-muted">
                    Add a codebase to create your first analysis and start building an evidence-based view of its health.
                  </p>
                  <Link href="/repositories#upload-codebase" className="mt-4 inline-flex items-center gap-2 text-xs font-medium text-primary hover:text-white">
                    Add your first repository <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {repositories.map(({ repository, history }) => {
                    const latestRun = sortNewestFirst(
                      history,
                      ({ run }) => run.startedAt ?? run.createdAt,
                    )[0]?.run;
                    return (
                      <li key={repository.id}>
                        <Link
                          href={`/repositories/${repository.id}`}
                          className="group grid min-w-0 gap-2 px-4 py-3 transition-colors hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-primary sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                        >
                          <span className="flex min-w-0 items-center gap-3">
                            <GitBranch className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium text-white">{repository.fullName}</span>
                              <span className="mt-1 block truncate text-xs text-text-muted">
                                {repository.provider === "GITHUB" ? "GitHub" : "Local"} · {repository.defaultBranch}
                              </span>
                            </span>
                          </span>
                          <span className="flex min-w-0 items-center justify-between gap-3 sm:justify-end">
                            {latestRun ? (
                              <>
                                <StatusLabel value={latestRun.status} />
                                <span className="truncate text-[11px] text-text-muted">{formatTimestamp(latestRun.startedAt ?? latestRun.createdAt)}</span>
                              </>
                            ) : (
                              <span className="text-xs text-text-muted">No analysis yet</span>
                            )}
                            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-text-muted group-hover:text-primary" aria-hidden="true" />
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <div className="grid min-w-0 content-start gap-5">
              <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
                <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
                  <div>
                    <h2 className="text-sm font-semibold text-white">Recent activity</h2>
                    <p className="mt-1 text-xs text-text-muted">Latest persisted analysis runs.</p>
                  </div>
                  <Link href="/history" className="shrink-0 text-xs font-medium text-primary hover:text-white">
                    View history
                  </Link>
                </div>
                {summary.recentActivity.length === 0 ? (
                  <p className="px-4 py-7 text-sm text-text-muted">No analysis activity yet.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {summary.recentActivity.map(({ repository, run }) => (
                      <li key={run.id}>
                        <Link
                          href={`/analysis/${run.id}`}
                          className="flex min-w-0 items-start justify-between gap-3 px-4 py-3 transition-colors hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-primary"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-medium text-white">{repository.fullName}</span>
                            <span className="mt-1 block font-mono text-[10px] text-text-muted">
                              {(run.commitSha ?? run.commitId).slice(0, 12)} · {formatTimestamp(run.startedAt ?? run.createdAt)}
                            </span>
                          </span>
                          <StatusLabel value={run.status} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="rounded-xl border border-border bg-card p-4">
                <h2 className="text-sm font-semibold text-white">Security overview</h2>
                {summary.securityFindingCount === 0 ? (
                  <p className="mt-2 text-sm leading-6 text-text-muted">No open security findings are recorded.</p>
                ) : (
                  <>
                    <p className="mt-2 text-xs text-text-muted">Open findings by severity</p>
                    <dl className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5 xl:grid-cols-3 2xl:grid-cols-5">
                      {Object.entries(summary.securitySeverityCounts).map(([severity, count]) => (
                        <div key={severity} className="min-w-0 rounded-lg border border-border px-2.5 py-2">
                          <dt className="truncate text-[9px] font-medium uppercase tracking-wide text-text-muted">{severity}</dt>
                          <dd className="mt-1 font-mono text-lg font-semibold text-white">{count}</dd>
                        </div>
                      ))}
                    </dl>
                    <Link href="/findings" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-white">
                      Review findings <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  </>
                )}
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
