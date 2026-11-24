"use client";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section role="alert" className="rounded-xl border border-rose-900/60 bg-card p-6">
      <h2 className="text-sm font-semibold text-white">This page could not be loaded</h2>
      <p className="mt-2 text-sm text-text-muted">Your workspace is still available. Try loading this page again.</p>
      <button
        type="button"
        onClick={reset}
        className="mt-4 min-h-9 rounded-lg border border-border px-3 text-xs font-medium text-white hover:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      >
        Try again
      </button>
    </section>
  );
}
