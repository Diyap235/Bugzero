"use client";

import { LogOut } from "lucide-react";
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
  const handleLogout = () => {
    logout();
    router.replace("/login");
  };

  return (
    <header className="h-14 bg-background/95 border-b border-border px-4 sm:px-6 flex items-center justify-between sticky top-0 z-20">
      <div className="text-xs text-text-muted" aria-label="Current page">
        Workspace <span className="mx-2 text-border">/</span><span className="text-text-primary">{title}</span>
      </div>
      <div className="flex items-center gap-3">
        {user && <span className="hidden text-xs text-text-muted sm:inline">{user.email}</span>}
        <button
          type="button"
          onClick={handleLogout}
          className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-medium text-text-secondary transition-colors hover:border-primary hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        >
          <LogOut className="h-3.5 w-3.5" aria-hidden="true" /> Log out
        </button>
      </div>
    </header>
  );
}
