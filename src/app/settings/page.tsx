import Link from "next/link";
import { Bell, SlidersHorizontal, UserRound } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeading } from "@/components/product/ui";

const settings = [
  { title: "Profile", description: "Personal account details and profile preferences.", icon: UserRound },
  { title: "Notifications", description: "Alerts for completed analyses and important findings.", icon: Bell },
  { title: "Preferences", description: "Workspace appearance and analysis defaults.", icon: SlidersHorizontal },
];

export default function SettingsPage() {
  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeading eyebrow="Workspace" title="Settings" description="Manage your BugZero workspace preferences." />
        <div className="grid gap-3 lg:grid-cols-3">
          {settings.map(({ title, description, icon: Icon }) => (
            <section key={title} className="rounded-xl border border-border bg-card p-5">
              <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
              <h2 className="mt-4 text-sm font-semibold text-white">{title}</h2>
              <p className="mt-2 text-xs leading-5 text-text-muted">{description}</p>
              <p className="mt-4 border-t border-border pt-3 text-[10px] text-text-muted">Not available in this workspace yet.</p>
            </section>
          ))}
        </div>
        <Link href="/repositories" className="inline-flex text-xs text-primary hover:underline">Explore repositories →</Link>
      </div>
    </AppShell>
  );
}
