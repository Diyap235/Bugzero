"use client";

import { useCallback } from "react";
import Link from "next/link";
import { FileText } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeading, ResourceState, formatTimestamp } from "@/components/product/ui";
import { useApiResource } from "@/hooks/useApiResource";
import { bugzeroApi } from "@/lib/api-client";
import type { ApiReport } from "@/domains/product/types";

interface ReportsData {
  repositories: Array<{ id: string; fullName: string }>;
  reports: ApiReport[];
}

export default function ReportsPage() {
  const load = useCallback(async (): Promise<ReportsData> => {
    const repositories = await bugzeroApi.listRepositories();
    const reports = await Promise.all(repositories.map((repository) =>
      bugzeroApi.getRepositoryReports(repository.id)));
    return {
      repositories,
      reports: reports.flat(),
    };
  }, []);
  const resource = useApiResource(load);
  const data = resource.data;
  const repositoryNames = new Map((data?.repositories ?? []).map(({ id, fullName }) => [id, fullName]));
  const reports = data?.reports ?? [];

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeading eyebrow="Persisted report summaries" title="Reports" description="Review report records created for repository analyses. Report generation and downloads are not currently supported." />
        <ResourceState
          loading={resource.loading}
          error={resource.error}
          empty={Boolean(data && reports.length === 0)}
          retry={resource.refresh}
          emptyTitle={data?.repositories.length ? "No reports are available" : "No repositories are available"}
        />
        {data && !resource.error && reports.length > 0 && (
          <section className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="divide-y divide-border">
              {reports.map((report) => (
                <article key={report.id} className="flex flex-wrap items-center justify-between gap-4 px-4 py-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white">{repositoryNames.get(report.repositoryId) ?? "Repository unavailable"}</p>
                      <p className="mt-1 break-all font-mono text-[10px] text-text-muted">Report {report.id} · Analysis {report.analysisRunId}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-text-secondary">
                    <span className="font-mono">{report.format}</span>
                    <span>{formatTimestamp(report.createdAt)}</span>
                  </div>
                </article>
              ))}
            </div>
            <p className="border-t border-border px-4 py-3 text-xs text-text-muted">
              Report summaries are persisted by the backend. File generation and download links are not available.
            </p>
          </section>
        )}
        {!resource.error && data?.repositories.length === 0 && (
          <Link href="/repositories" className="inline-flex text-xs text-primary hover:underline">Explore repositories →</Link>
        )}
      </div>
    </AppShell>
  );
}
