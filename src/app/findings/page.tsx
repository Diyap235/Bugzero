"use client";

import Link from "next/link";
import { Suspense, useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeading, ResourceState, StatusLabel, formatTimestamp } from "@/components/product/ui";
import { useApiResource } from "@/hooks/useApiResource";
import { bugzeroApi } from "@/lib/api-client";

const pageSize = 25;

function FindingsContent() {
  const params = useSearchParams();
  const repositoryFilter = params.get("repositoryId") ?? "";
  const [severity, setSeverity] = useState("ALL");
  const [lifecycle, setLifecycle] = useState("ALL");
  const [rule, setRule] = useState("");
  const [file, setFile] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const load = useCallback(async () => {
    const repositories = await bugzeroApi.listRepositories();
    const rows = await Promise.all(repositories.map(async (repository) => ({
      repository,
      findings: await bugzeroApi.getRepositoryFindings(repository.id),
    })));
    return rows.flatMap(({ repository, findings }) => findings.map((row) => ({ ...row, repository })));
  }, []);
  const resource = useApiResource(load);
  const all = useMemo(() => resource.data ?? [], [resource.data]);
  const visible = useMemo(() => all.filter(({ finding, occurrence, repository }) => {
    if (repositoryFilter && repository.id !== repositoryFilter) return false;
    if (severity !== "ALL" && finding.currentSeverity !== severity) return false;
    if (lifecycle !== "ALL" && finding.lifecycle !== lifecycle) return false;
    if (rule && !finding.ruleId.toLowerCase().includes(rule.toLowerCase())) return false;
    if (file && !(occurrence?.filePath ?? "").toLowerCase().includes(file.toLowerCase())) return false;
    const text = `${finding.ruleId} ${occurrence?.filePath ?? ""} ${repository.fullName}`.toLowerCase();
    return !search || text.includes(search.toLowerCase());
  }).sort((a, b) => b.finding.currentRisk - a.finding.currentRisk), [all, repositoryFilter, severity, lifecycle, rule, file, search]);
  const countOpen = all.filter(({ finding }) => !["RESOLVED", "DISMISSED"].includes(finding.lifecycle)).length;
  const countCurrent = visible.length;
  const pages = Math.max(1, Math.ceil(countCurrent / pageSize));
  const rows = visible.slice(page * pageSize, (page + 1) * pageSize);

  return (
    <AppShell>
      <div className="space-y-5">
        <PageHeading eyebrow="Investigation workspace" title="Findings" description={`${countOpen} open of ${all.length} persisted findings. Severity and technical risk are displayed separately.`} />
        <ResourceState loading={resource.loading} error={resource.error} empty={all.length === 0} retry={resource.refresh} emptyTitle="No findings are available" />
        {!resource.error && all.length > 0 && (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              <label className="text-[10px] uppercase tracking-wide text-text-muted">Severity<select value={severity} onChange={(event) => { setSeverity(event.target.value); setPage(0); }} className="mt-1 block h-10 w-full rounded-lg border border-border bg-card px-3 text-xs text-white"><option>ALL</option>{["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"].map((option) => <option key={option}>{option}</option>)}</select></label>
              <label className="text-[10px] uppercase tracking-wide text-text-muted">Lifecycle<select value={lifecycle} onChange={(event) => { setLifecycle(event.target.value); setPage(0); }} className="mt-1 block h-10 w-full rounded-lg border border-border bg-card px-3 text-xs text-white"><option>ALL</option>{["OPEN", "CONFIRMED", "IN_PROGRESS", "RESOLVED", "DISMISSED", "REOPENED"].map((option) => <option key={option}>{option}</option>)}</select></label>
              <label className="text-[10px] uppercase tracking-wide text-text-muted">Rule<input value={rule} onChange={(event) => { setRule(event.target.value); setPage(0); }} placeholder="Filter by rule ID" className="mt-1 block h-10 w-full rounded-lg border border-border bg-card px-3 text-xs text-white placeholder:text-text-muted" /></label>
              <label className="text-[10px] uppercase tracking-wide text-text-muted">File<input value={file} onChange={(event) => { setFile(event.target.value); setPage(0); }} placeholder="Filter by file path" className="mt-1 block h-10 w-full rounded-lg border border-border bg-card px-3 text-xs text-white placeholder:text-text-muted" /></label>
            </div>
            <label className="block max-w-xl text-[10px] uppercase tracking-wide text-text-muted">Search repository, rule, or file<input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Search findings" className="mt-1 block h-10 w-full rounded-lg border border-border bg-card px-3 text-xs text-white placeholder:text-text-muted" /></label>
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <table className="w-full min-w-[900px] text-left">
                <thead className="bg-surface text-[10px] uppercase tracking-wide text-text-muted"><tr>{["Severity", "Risk", "Finding / rule", "Repository", "File / line", "Lifecycle", "Confidence", "Last seen"].map((heading) => <th key={heading} className="px-4 py-3 font-medium">{heading}</th>)}</tr></thead>
                <tbody className="divide-y divide-border">
                  {rows.map(({ finding, occurrence, repository }) => (
                    <tr key={finding.id} className="hover:bg-surface-hover">
                      <td className="px-4 py-3"><span className="font-mono text-[10px] font-semibold text-white">{finding.currentSeverity}</span></td>
                      <td className="px-4 py-3 font-mono text-xs text-text-secondary">{finding.currentRisk}</td>
                      <td className="max-w-64 px-4 py-3"><Link href={`/findings/${finding.id}`} className="block truncate text-xs font-semibold text-white hover:text-primary">{finding.ruleId.replaceAll(".", " ")}</Link><span className="mt-1 block truncate font-mono text-[10px] text-text-muted">{finding.ruleId}</span></td>
                      <td className="max-w-44 truncate px-4 py-3 text-xs text-text-secondary">{repository.fullName}</td>
                      <td className="max-w-64 truncate px-4 py-3 font-mono text-[10px] text-text-secondary">{occurrence?.filePath ? `${occurrence.filePath}${occurrence.startLine ? `:${occurrence.startLine}` : ""}` : "Location unavailable"}</td>
                      <td className="px-4 py-3"><StatusLabel value={finding.lifecycle} /></td>
                      <td className="px-4 py-3 text-xs text-text-secondary">{occurrence?.assessment.confidence ?? finding.currentConfidence}</td>
                      <td className="px-4 py-3 text-[10px] text-text-muted">{formatTimestamp(finding.updatedAt)}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-text-muted">No findings match the selected filters.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between text-xs text-text-muted"><span>{countCurrent ? `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, countCurrent)} of ${countCurrent}` : "0 results"}</span><div className="flex gap-2"><button disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))} className="rounded border border-border px-3 py-2 text-white disabled:opacity-40">Previous</button><button disabled={page + 1 >= pages} onClick={() => setPage((value) => Math.min(pages - 1, value + 1))} className="rounded border border-border px-3 py-2 text-white disabled:opacity-40">Next</button></div></div>
          </>
        )}
      </div>
    </AppShell>
  );
}

export default function FindingsPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-background p-8 text-sm text-text-muted">Preparing findings…</main>}>
      <FindingsContent />
    </Suspense>
  );
}
