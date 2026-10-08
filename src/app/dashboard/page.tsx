"use client";

import Link from "next/link";
import { ArrowRight, GitBranch } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeading } from "@/components/product/ui";
import { sampleFindings, sampleHealthHistory, sampleOverview, sampleWorkspace } from "@/domains/product/sample-data";

const dashboard = {
  overview: sampleOverview,
  findings: sampleFindings,
  healthHistory: sampleHealthHistory,
};

export default function DashboardPage() {
  const { overview, findings, healthHistory } = dashboard;
  const health = overview.latestHealth;
  const coverage = health?.dimensions?.quality?.inputMetrics?.coveragePercent;
  const metrics = [
    { label: "Repository health", value: health?.overall_score ?? "Unknown", detail: "Overall score" },
    { label: "Open findings", value: overview.findingCounts.open, detail: `${overview.findingCounts.total} total findings` },
    { label: "Critical / high-risk", value: `${overview.findingCounts.critical} / ${overview.findingCounts.highRisk}`, detail: "Needs investigation" },
    { label: "Security", value: health?.security_score ?? "Unknown", detail: "Security score" },
    { label: "Quality", value: health?.quality_score ?? "Unknown", detail: "Quality score" },
    { label: "Coverage", value: typeof coverage === "number" ? `${coverage}%` : "Unknown", detail: "Test coverage" },
  ];
  const healthPoints = healthHistory.map(({ snapshot }) => snapshot.overall_score ?? 0).reverse();

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
        <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-white">{overview.repository.fullName}</p>
              <p className="mt-1 text-xs text-text-muted">
                {overview.repository.provider === "GITHUB" ? "GitHub" : overview.repository.provider}
                {" · "}{overview.repository.defaultBranch}
                {" · Sample data"}
              </p>
              <p className="mt-1 text-xs text-text-muted">{sampleWorkspace.repository.languages.join(" · ")}</p>
            </div>
            <span className="rounded-md border border-border px-2 py-1 font-mono text-[10px] text-text-secondary">
              {overview.latestRun?.status ?? "NOT ANALYZED"}
            </span>
          </div>
        </section>

        <section aria-label="Repository metrics" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {metrics.map(({ label, value, detail }) => (
            <div key={label} className="rounded-xl border border-border bg-card p-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">{label}</p>
              <p className="mt-2 font-mono text-2xl font-semibold text-white">{value}</p>
              <p className="mt-1 text-xs text-text-muted">{detail}</p>
            </div>
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
            <div className="divide-y divide-border">
              {findings.slice(0, 5).map(({ finding, occurrence }) => (
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
                    {occurrence?.filePath ?? "Location unavailable"}
                    {typeof occurrence?.startLine === "number" ? `:${occurrence.startLine}` : ""}
                  </span>
                </Link>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-white">Repository health</h2>
                <p className="mt-1 text-xs text-text-muted">
                  Latest analysis · {overview.latestRun?.status ?? "Not analyzed"}
                </p>
              </div>
              <Link href="/health" className="text-xs font-medium text-primary hover:text-white">Details</Link>
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
              <p className="mt-6 text-sm text-text-muted">No health history is available yet.</p>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}
