export default function Loading() {
  return (
    <section aria-label="Loading page content" aria-busy="true" className="space-y-5">
      <div className="h-3 w-36 animate-pulse rounded bg-card" />
      <div className="h-8 w-56 animate-pulse rounded bg-card" />
      <div className="h-4 max-w-xl animate-pulse rounded bg-card" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="h-28 animate-pulse rounded-xl border border-border bg-card" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-xl border border-border bg-card" />
    </section>
  );
}
