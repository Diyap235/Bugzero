"use client";

import { useCallback, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Metric, PageHeading, ResourceState, StatusLabel, formatDuration, formatTimestamp } from "@/components/product/ui";
import { useApiResource } from "@/hooks/useApiResource";
import { bugzeroApi } from "@/lib/api-client";
import { sampleAnalysisStatus } from "@/domains/product/sample-data";

const finalStates = new Set(["COMPLETED", "PARTIAL", "FAILED", "UNAVAILABLE"]);

export default function AnalysisDetailPage() {
  const params = useParams<{ id: string }>();
  const load = useCallback(() => bugzeroApi.getAnalysisStatus(params.id), [params.id]);
  const resource = useApiResource(load, sampleAnalysisStatus);
  const status = resource.data;

  useEffect(() => {
    if (!status || finalStates.has(status.status)) return;
    const timer = setTimeout(resource.refresh, 1800);
    return () => clearTimeout(timer);
  }, [status, resource.refresh]);

  const metrics = status?.progress ?? {};
  return (
    <AppShell>
      <div className="space-y-6">
        <Link href="/history" className="inline-flex items-center gap-2 text-xs text-text-muted hover:text-white"><ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />Analysis history</Link>
        <PageHeading eyebrow="Analysis run" title={params.id} description="Analysis status, workflow stage, and available progress details." action={status && !finalStates.has(status.status) ? <RefreshCw className="h-4 w-4 animate-spin text-primary" aria-label="Analysis is active" /> : undefined} />
        <ResourceState loading={resource.loading} error={resource.error} empty={!status} retry={resource.refresh} sample={resource.isFallback} emptyTitle="Analysis run not found" />
        {status && (!resource.error || resource.isFallback) && (
          <>
            <div className="flex items-center justify-between rounded-xl border border-border bg-card p-4"><div><p className="text-xs text-text-muted">Run status</p><p className="mt-2 text-sm text-white">{status.status}</p></div><StatusLabel value={status.status} /></div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric label="Job stage" value={status.job?.stage ?? "Not reported"} />
              <Metric label="Job state" value={status.job?.status ?? "Not reported"} />
              <Metric label="Started" value={formatTimestamp(status.startedAt)} />
              <Metric label="Duration" value={formatDuration(status.startedAt, status.completedAt)} />
            </div>
            {status.failure && <div role="alert" className="rounded-lg border border-rose-800/60 bg-rose-950/20 p-4 text-sm text-rose-100">{status.failure}</div>}
            {Object.keys(metrics).length === 0 ? <p className="rounded-xl border border-border bg-card p-4 text-xs text-text-muted">No progress metrics have been returned for this run yet.</p> : (
              <section className="rounded-xl border border-border bg-card">
                <div className="border-b border-border px-4 py-3"><h2 className="text-sm font-semibold text-white">Reported progress</h2><p className="mt-1 text-xs text-text-muted">Available progress indicators for this analysis.</p></div>
                <dl className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-3">{Object.entries(metrics).map(([key, value]) => (
                  <div key={key} className="min-w-0 bg-card p-4"><dt className="text-[10px] uppercase tracking-wide text-text-muted">{key}</dt><dd className="mt-2 break-words font-mono text-xs text-white">{typeof value === "object" ? JSON.stringify(value) : String(value)}</dd></div>
                ))}</dl>
              </section>
            )}
            <p className="text-[10px] leading-5 text-text-muted">Analysis progress is represented by workflow stages rather than a percentage.</p>
          </>
        )}
      </div>
    </AppShell>
  );
}
