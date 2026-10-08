"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { ArrowRight, GitBranch, Search } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeading, ResourceState, StatusLabel, formatTimestamp } from "@/components/product/ui";
import { useApiResource } from "@/hooks/useApiResource";
import { bugzeroApi } from "@/lib/api-client";
import { sampleOverview } from "@/domains/product/sample-data";

const sampleRepositories = [sampleOverview];

export default function RepositoriesPage() {
  const [query, setQuery] = useState("");
  const load = useCallback(async () => {
    const repositories = await bugzeroApi.listRepositories();
    return Promise.all(repositories.map((repository) => bugzeroApi.getRepository(repository.id)));
  }, []);
  const resource = useApiResource(load, sampleRepositories);
  const repositories = resource.data ?? sampleRepositories;
  const filtered = useMemo(() => repositories.filter(({ repository }) =>
    repository.fullName.toLowerCase().includes(query.toLowerCase())), [repositories, query]);

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeading eyebrow="Workspace" title="Repositories" description="Explore repositories, review current health, and start an analysis." />
        <div className="relative max-w-xl">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden="true" />
          <label className="sr-only" htmlFor="repository-search">Search repositories</label>
          <input id="repository-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by repository name" className="h-10 w-full rounded-lg border border-border bg-card pl-10 pr-3 text-sm text-white placeholder:text-text-muted focus:border-primary focus:outline-none" />
        </div>
        <ResourceState loading={resource.loading} error={resource.error} empty={repositories.length === 0} retry={resource.refresh} sample={resource.isFallback} emptyTitle="No repositories are available" />
        {(!resource.error || resource.isFallback) && repositories.length > 0 && filtered.length === 0 && (
          <p className="rounded-xl border border-border bg-card px-4 py-8 text-center text-sm text-text-muted">No repository names match “{query}”.</p>
        )}
        {filtered.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="hidden grid-cols-[minmax(0,1.5fr)_minmax(130px,1fr)_minmax(120px,0.8fr)_100px_140px] gap-4 border-b border-border bg-surface px-4 py-3 text-[10px] font-semibold uppercase tracking-wide text-text-muted md:grid">
              <span>Repository</span><span>Default branch</span><span>Current commit</span><span>Health</span><span>Latest analysis</span>
            </div>
            <div className="divide-y divide-border">
              {filtered.map(({ repository, latestCommit, latestRun, latestHealth, findingCounts }) => (
                <Link key={repository.id} href={`/repositories/${repository.id}`} className="grid min-w-0 gap-3 px-4 py-4 hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary md:grid-cols-[minmax(0,1.5fr)_minmax(130px,1fr)_minmax(120px,0.8fr)_100px_140px] md:items-center md:gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <GitBranch className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">{repository.fullName}</p>
                      <p className="mt-1 truncate text-[10px] text-text-muted">{repository.provider === "GITHUB" ? "GitHub" : repository.provider} · {findingCounts.open} open findings{"languages" in repository && Array.isArray(repository.languages) ? ` · ${repository.languages.join(" · ")}` : ""}</p>
                    </div>
                  </div>
                  <div className="min-w-0"><span className="text-[10px] text-text-muted md:hidden">Branch · </span><span className="truncate font-mono text-xs text-text-secondary">{repository.defaultBranch}</span></div>
                  <div className="min-w-0"><span className="text-[10px] text-text-muted md:hidden">Commit · </span><span className="truncate font-mono text-xs text-text-secondary">{latestCommit?.commitSha.slice(0, 12) ?? "Not indexed"}</span></div>
                  <div className="text-xs text-text-secondary"><span className="text-[10px] text-text-muted md:hidden">Health · </span>{latestHealth?.overall_score ?? "Unknown"}</div>
                  <div className="flex items-center justify-between gap-2"><StatusLabel value={latestRun?.status ?? "NOT_ANALYZED"} /><span className="hidden text-[10px] text-text-muted xl:inline">{formatTimestamp(latestRun?.createdAt)}</span><span className="inline-flex items-center gap-1 text-xs font-medium text-primary">Analyze <ArrowRight className="h-4 w-4" aria-hidden="true" /></span></div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
