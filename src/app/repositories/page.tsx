"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useMemo, useState } from "react";
import { ArrowRight, GitBranch, Search } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeading, ResourceState, StatusLabel, formatTimestamp } from "@/components/product/ui";
import { useApiResource } from "@/hooks/useApiResource";
import { bugzeroApi } from "@/lib/api-client";

export default function RepositoriesPage() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [repositoryName, setRepositoryName] = useState("");
  const [archive, setArchive] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [createdRepository, setCreatedRepository] = useState<{ id: string; name: string } | null>(null);
  const load = useCallback(async () => {
    const repositories = await bugzeroApi.listRepositories();
    return Promise.all(repositories.map((repository) => bugzeroApi.getRepository(repository.id)));
  }, []);
  const resource = useApiResource(load);
  const repositories = useMemo(() => resource.data ?? [], [resource.data]);
  const filtered = useMemo(() => repositories.filter(({ repository }) =>
    repository.fullName.toLowerCase().includes(query.toLowerCase())), [repositories, query]);

  async function uploadRepository(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!archive) {
      setUploadError("Choose a ZIP archive to upload.");
      return;
    }
    setUploading(true);
    setUploadError(null);
    setUploadMessage(null);
    setCreatedRepository(null);
    try {
      const { upload: result, analysis, analysisError } = await bugzeroApi.uploadAndAnalyzeRepository(repositoryName, archive);
      const created = { id: result.repository.id, name: result.repository.fullName };
      setCreatedRepository(created);
      setArchive(null);
      setRepositoryName("");
      setFileInputKey((key) => key + 1);
      if (analysisError) {
        setUploadError(`The repository was created, but analysis did not start: ${analysisError.message}`);
        resource.refresh();
        return;
      }
      setUploadMessage(`Created ${created.name} with ${result.filesPersisted} persisted source files; analysis ${analysis.status}.`);
      router.push(`/repositories/${result.repository.id}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "The upload and analysis request could not be completed.";
      setUploadError(detail);
      resource.refresh();
    } finally {
      setUploading(false);
    }
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeading eyebrow="Workspace" title="Repositories" description="Upload a codebase ZIP to create a repository and start its first analysis." />
        <form id="upload-codebase" onSubmit={uploadRepository} className="space-y-3 rounded-xl border border-border bg-card p-4" aria-label="Upload a codebase ZIP">
          <div>
            <h2 className="text-sm font-semibold text-white">Upload Codebase (.zip)</h2>
            <p className="mt-1 text-xs leading-5 text-text-muted">Upload a ZIP containing JavaScript, TypeScript, or Python source files.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-end">
            <div className="space-y-1">
              <label htmlFor="local-repository-name" className="text-xs text-text-secondary">Repository name</label>
              <input id="local-repository-name" value={repositoryName} onChange={(event) => setRepositoryName(event.target.value)} required maxLength={100} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-white focus:border-primary focus:outline-none" />
            </div>
            <div className="space-y-1">
              <label htmlFor="local-repository-zip" className="text-xs text-text-secondary">ZIP archive</label>
              <input key={fileInputKey} id="local-repository-zip" type="file" accept=".zip,application/zip" required onChange={(event) => setArchive(event.target.files?.[0] ?? null)} className="block min-h-10 w-full rounded-lg border border-border bg-background px-2 py-2 text-xs text-text-secondary file:mr-3 file:rounded-md file:border-0 file:bg-surface file:px-2 file:py-1 file:text-xs file:text-white" />
            </div>
            <button type="submit" disabled={uploading || !archive} className="h-10 rounded-lg bg-primary px-4 text-sm font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60">
              {uploading ? "Uploading…" : "Upload Codebase"}
            </button>
          </div>
          {uploading && <p role="status" className="text-xs text-text-muted">Validating the ZIP, saving its source snapshot, and starting analysis…</p>}
          {uploadMessage && <p role="status" className="text-xs text-emerald-300">{uploadMessage}</p>}
          {uploadError && <p role="alert" className="text-xs text-rose-300">{uploadError}</p>}
          {createdRepository && uploadError && (
            <Link href={`/repositories/${createdRepository.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              View {createdRepository.name} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          )}
        </form>
        <div className="relative max-w-xl">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden="true" />
          <label className="sr-only" htmlFor="repository-search">Search repositories</label>
          <input id="repository-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by repository name" className="h-10 w-full rounded-lg border border-border bg-card pl-10 pr-3 text-sm text-white placeholder:text-text-muted focus:border-primary focus:outline-none" />
        </div>
        {(resource.loading || resource.error) && <ResourceState loading={resource.loading} error={resource.error} empty={false} retry={resource.refresh} />}
        {!resource.loading && !resource.error && repositories.length === 0 && (
          <section className="rounded-xl border border-dashed border-border bg-card px-5 py-12 text-center">
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary">Workspace ready</p>
            <h2 className="mt-3 text-xl font-semibold text-white">Welcome to BugZero</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-text-muted">No codebase added yet. Let&apos;s analyze your first codebase.</p>
            <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-text-muted">Upload your codebase to start your first BugZero analysis.</p>
            <a href="#upload-codebase" className="mt-5 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-white hover:bg-primary/90">
              Upload Codebase <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </a>
          </section>
        )}
        {!resource.error && repositories.length > 0 && filtered.length === 0 && (
          <p className="rounded-xl border border-border bg-card px-4 py-8 text-center text-sm text-text-muted">No repository names match “{query}”.</p>
        )}
        {!resource.error && filtered.length > 0 && (
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
