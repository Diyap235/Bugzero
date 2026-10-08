"use client";

import { AlertTriangle, LoaderCircle, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

export function PageHeading({ eyebrow, title, description, action }: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.16em] text-primary">{eyebrow}</p>}
        <h1 className="break-words text-2xl font-semibold tracking-tight text-white">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm leading-6 text-text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Metric({ label, value, detail, tone = "neutral" }: {
  label: string;
  value: string | number;
  detail?: string;
  tone?: "neutral" | "good" | "warning" | "danger";
}) {
  const tones = {
    neutral: "text-white",
    good: "text-emerald-300",
    warning: "text-amber-300",
    danger: "text-rose-300",
  };
  return (
    <section className="min-w-0 rounded-xl border border-border bg-card p-4">
      <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">{label}</p>
      <p className={`mt-2 break-words font-mono text-2xl font-semibold ${tones[tone]}`}>{value}</p>
      {detail && <p className="mt-1 break-words text-xs text-text-muted">{detail}</p>}
    </section>
  );
}

export function StateMessage({ title, message, onRetry, action }: {
  title: string;
  message: string;
  onRetry?: () => void;
  action?: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card px-5 py-10 text-center" role="status">
      {title === "Loading workspace" ? (
        <LoaderCircle className="mx-auto h-5 w-5 animate-spin text-primary" aria-hidden="true" />
      ) : (
        <AlertTriangle className="mx-auto h-5 w-5 text-amber-300" aria-hidden="true" />
      )}
      <h2 className="mt-3 text-sm font-semibold text-white">{title}</h2>
      <p className="mx-auto mt-1 max-w-2xl break-words text-sm leading-6 text-text-muted">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-4 inline-flex min-h-9 items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs text-white hover:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Retry
        </button>
      )}
      {action}
    </section>
  );
}

export function ResourceState({ loading, error, empty, retry, emptyTitle = "No data available", sample = false }: {
  loading: boolean;
  error: Error | null;
  empty: boolean;
  retry?: () => void;
  emptyTitle?: string;
  sample?: boolean;
}) {
  if (sample) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card/70 px-3 py-2 text-[11px] text-text-muted" role="status">
        <span>Sample data · Example repository and findings are shown until workspace data is available.</span>
        {retry && <button onClick={retry} className="text-primary hover:underline">Refresh</button>}
      </div>
    );
  }
  if (loading) return <StateMessage title="Loading workspace" message="Preparing your repository intelligence…" />;
  if (error) return <StateMessage title="Workspace data unavailable" message="This view couldn't be loaded right now. Try again in a moment." onRetry={retry} />;
  if (empty) return <StateMessage title={emptyTitle} message="There are no records to show for this view yet." />;
  return null;
}

export function StatusLabel({ value }: { value: string | null | undefined }) {
  const status = value ?? "UNKNOWN";
  const tone = status === "COMPLETED" || status === "COMPLETE" || status === "RESOLVED" || status === "AUTHORITATIVE"
    ? "border-emerald-700/50 bg-emerald-950/40 text-emerald-200"
    : status === "FAILED" || status === "INCOMPLETE" || status === "CRITICAL" || status === "INVESTIGATIVE"
      ? "border-rose-800/60 bg-rose-950/30 text-rose-200"
      : status === "RUNNING" || status === "PARTIAL" || status === "QUEUED"
        ? "border-amber-700/50 bg-amber-950/30 text-amber-200"
        : "border-border bg-background text-text-secondary";
  return <span className={`inline-flex max-w-full items-center rounded-md border px-2 py-1 font-mono text-[10px] leading-4 ${tone}`}>{status.replaceAll("_", " ")}</span>;
}

export function UnknownValue({ explanation }: { explanation?: string | null }) {
  return (
    <span className="inline-flex flex-col items-start gap-1 text-text-muted">
      <span className="font-mono text-sm">Unknown</span>
      {explanation && <span className="text-xs leading-5">{explanation}</span>}
    </span>
  );
}

export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatDuration(start: string | null | undefined, end: string | null | undefined): string {
  if (!start || !end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  return ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}
