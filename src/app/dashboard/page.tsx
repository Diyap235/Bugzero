"use client";

import Link from "next/link";
import { useCallback } from "react";
import { ArrowRight, GitBranch } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Metric, PageHeading, ResourceState } from "@/components/product/ui";
import { useApiResource } from "@/hooks/useApiResource";
import { bugzeroApi } from "@/lib/api-client";
import type { FindingRow, HealthHistoryEntry, RepositoryOverview } from "@/domains/product/types";

interface DashboardRepository {
  overview: RepositoryOverview;
  findings: FindingRow[];
  healthHistory: HealthHistoryEntry[];
}

export default function DashboardPage() {
  const load = useCallback(async (): Promise<DashboardRepository[]> => {
    const repositories = await bugzeroApi.listRepositories();
    return Promise.all(repositories.map(async ({ id }) => {
      const [overview, findings, healthHistory] = await Promise.all([
        bugzeroApi.getRepository(id),
        bugzeroApi.getRepositoryFindings(id),
        bugzeroApi.getHealthHistory(id),
      ]);
      return { overview, findings, healthHistory };
    }));
  }, []);
  const resource = useApiResource(load);
  const repositories = resource.data ?? [];
  const overview = repositories[0]?.overview;
  const findings = repositories.flatMap(({ overview: repository, findings: items }) =>
    items.map((item) => ({ ...item, repository: repository.repository })));
  const totalFindings = repositories.reduce((total, entry) => total + entry.overview.findingCounts.total, 0);
  const openFindings = repositories.reduce((total, entry) => total + entry.overview.findingCounts.open, 0);
  const criticalFindings = repositories.reduce((total, entry) => total + entry.overview.findingCounts.critical, 0);
  const highRiskFindings = repositories.reduce((total, entry) => total + entry.overview.findingCounts.highRisk, 0);
  const health = overview?.latestHealth;
  const coverage = health?.dimensions?.quality?.inputMetrics?.coveragePercent;
  const metrics = [
    { label: "Repository health", value: health?.overall_score ?? "Unknown", detail: overview?.repository.fullName ?? "No repository selected" },
    { label: "Open findings", value: openFindings, detail: `${totalFindings} total findings` },
    { label: "Critical / high-risk", value: `${criticalFindings} / ${highRiskFindings}`, detail: "Needs investigation" },
    { label: "Security", value: health?.security_score ?? "Unknown", detail: "Latest repository snapshot" },
    { label: "Quality", value: health?.quality_score ?? "Unknown", detail: "Latest repository snapshot" },
    { label: "Coverage", value: typeof coverage === "number" ? `${coverage}%` : "Unknown", detail: "Latest repository snapshot" },
  ];
  const healthPoints = (repositories[0]?.healthHistory ?? [])
    .map(({ snapshot }) => snapshot.overall_score)
    .filter((score): score is number => typeof score === "number")
    .reverse();

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeading
          eyebrow="Repository intelligence"
          title="Overview"
          description="Understand your repository, investigate findings, and track code health."
          action={
            <Link
              href="/repositories"
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium text-white transition-colors hover:border-primary"
            >
              <GitBranch className="h-4 w-4 text-primary" aria-hidden="true" /> Repositories
            </Link>
          }
        />
        <ResourceState
          loading={resource.loading}
          error={resource.error}
          empty={repositories.length === 0}
          retry={resource.refresh}
          emptyTitle="No repositories are available"
        />
        {!resource.error && overview && (
          <>
            <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-white">{overview.repository.fullName}</p>
                  <p className="mt-1 text-xs text-text-muted">
                    {overview.repository.provider === "GITHUB" ? "GitHub" : overview.repository.provider}
                    {" · "}{overview.repository.defaultBranch}
                    {" · "}{overview.latestRun?.status ?? "Not analyzed"}
                  </p>
                </div>
                <Link href={`/repositories/${overview.repository.id}`} className="text-xs font-medium text-primary hover:underline">Open repository →</Link>
              </div>
            </section>

            <section aria-label="Repository metrics" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {metrics.map(({ label, value, detail }) => (
                <Metric key={label} label={label} value={value} detail={detail} />
              ))}
            </section>

            <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
              <section className="rounded-xl border border-border bg-card">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <h2 className="text-sm font-semibold text-white">Recent findings</h2>
                  <Link href="/findings" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-white">
                    View all <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </div>
                {findings.length === 0 ? <p className="px-4 py-8 text-sm text-text-muted">No findings have been recorded for these repositories.</p> : (
                  <div className="divide-y divide-border">
                    {findings.slice(0, 5).map(({ finding, occurrence, repository }) => (
                      <Link
                        key={finding.id}
                        href={`/findings/${finding.id}`}
                        className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-surface-hover"
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <span className="shrink-0 font-mono text-[10px] font-semibold text-white">{finding.currentSeverity}</span>
                          <span className="truncate text-sm font-medium text-white">{finding.ruleId.replaceAll("_", " ")}</span>
                        </span>
                        <span className="font-mono text-[10px] text-text-muted">
                          {repository.fullName} · {occurrence?.filePath ?? "Location unavailable"}
                          {typeof occurrence?.startLine === "number" ? `:${occurrence.startLine}` : ""}
                        </span>
                      </Link>
                    ))}
                  </div>
                )}
              </section>

              <section className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-white">Repository health</h2>
                    <p className="mt-1 text-xs text-text-muted">
                      {overview.repository.fullName} · {overview.latestRun?.status ?? "Not analyzed"}
                    </p>
                  </div>
                  <Link href={`/health?repositoryId=${overview.repository.id}`} className="text-xs font-medium text-primary hover:text-white">Details</Link>
                </div>
                {healthPoints.length > 0 ? (
                  <div className="mt-6 flex h-20 items-end gap-2" aria-label="Health history trend">
                    {healthPoints.map((value, index) => (
                      <div
                        key={`${index}-${value}`}
                        title={`${value} / 100`}
                        className="flex-1 rounded-t bg-primary/70"
                        style={{ height: `${Math.max(value, 4)}%` }}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="mt-6 text-sm text-text-muted">No scored health snapshots are available yet.</p>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
