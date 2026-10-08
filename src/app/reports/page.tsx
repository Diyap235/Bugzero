import Link from "next/link";
import { FileText } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeading } from "@/components/product/ui";

export default function ReportsPage() {
  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeading eyebrow="Exports" title="Reports" description="Review repository intelligence in a shareable report." />
        <section className="rounded-xl border border-border bg-card p-6">
          <FileText className="h-5 w-5 text-text-muted" aria-hidden="true" />
          <h2 className="mt-3 text-sm font-semibold text-white">Reports are coming soon</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-text-muted">Your analysis history and findings are ready to explore while report exports are being prepared.</p>
          <Link href="/history" className="mt-4 inline-flex text-xs text-primary hover:underline">Review persisted analysis history →</Link>
        </section>
      </div>
    </AppShell>
  );
}
