"use client";

import Link from "next/link";
import { ChevronDown, LogOut, Settings } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/auth-context";

const routeNames: Record<string, string> = {
  "/dashboard": "Overview",
  "/repositories": "Repositories",
  "/findings": "Findings",
  "/health": "Repository health",
  "/history": "Analysis history",
  "/reports": "Reports",
  "/settings": "Settings",
};

export function Topbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();

  const title = pathname.startsWith("/repositories/") ? "Repository" : routeNames[pathname] ?? "Finding";
  const accountInitial = user?.email.slice(0, 1).toUpperCase() ?? "A";
  const handleLogout = () => {
    logout();
    router.replace("/login");
  };

  return (
    <header className="h-14 bg-background/95 border-b border-border px-4 sm:px-6 flex items-center justify-between sticky top-0 z-20">
      <div className="text-xs text-text-muted" aria-label="Current page">
        Workspace <span className="mx-2 text-border">/</span><span className="text-text-primary">{title}</span>
      </div>
      {user && (
        <details className="relative">
          <summary className="flex min-h-9 max-w-[55vw] cursor-pointer list-none items-center gap-2 rounded-lg border border-border px-2.5 text-xs text-text-secondary transition-colors hover:border-primary hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden sm:max-w-[16rem]">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-emerald-200">
              {accountInitial}
            </span>
            <span className="hidden truncate sm:inline">{user.email}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden="true" />
            <span className="sr-only">Open account menu</span>
          </summary>
          <div className="absolute right-0 top-full z-40 mt-2 w-56 rounded-xl border border-border bg-card p-1.5 shadow-lg">
            <p className="truncate px-3 py-2 text-[11px] text-text-muted">{user.email}</p>
            <Link href="/settings" className="flex min-h-9 items-center gap-2 rounded-lg px-3 text-xs text-text-secondary transition-colors hover:bg-surface-hover hover:text-white">
              <Settings className="h-3.5 w-3.5" aria-hidden="true" /> Settings
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="flex min-h-9 w-full items-center gap-2 rounded-lg px-3 text-left text-xs text-text-secondary transition-colors hover:bg-surface-hover hover:text-white"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" /> Log out
            </button>
          </div>
        </details>
      )}
    </header>
  );
}
