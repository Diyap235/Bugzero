"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth/auth-context";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { WORKSPACE_NAV_ITEMS } from "./navigation";

interface AppShellProps {
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  const pathname = usePathname();
  const router = useRouter();
  const auth = useAuth();
  React.useEffect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      const destination = auth.sessionExpired ? "/login?expired=1" : "/login";
      router.replace(destination);
    }
  }, [auth.isAuthenticated, auth.isLoading, auth.sessionExpired, router]);

  return (
    <div className="min-h-screen flex bg-background text-text-primary">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        {auth.isAuthenticated
          ? <Topbar />
          : <header className="h-14 border-b border-border px-4 sm:px-6 flex items-center text-xs text-text-muted">Workspace</header>}
        <main aria-busy={auth.isLoading || !auth.isAuthenticated} className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1600px] w-full mx-auto pb-24 md:pb-8">
          {auth.isLoading || !auth.isAuthenticated ? (
            <p role="status" className="text-sm text-text-muted">
              {auth.sessionExpired ? "Your session expired. Returning to sign in…" : "Checking your session…"}
            </p>
          ) : children}
        </main>
      </div>
      <nav aria-label="Mobile navigation" className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-surface border-t border-border grid grid-cols-7">
        {WORKSPACE_NAV_ITEMS.map(({ name, href, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              prefetch
              aria-label={name}
              aria-current={active ? "page" : undefined}
              className={`min-w-0 flex flex-col items-center justify-center gap-1 py-2 text-[9px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${active ? "text-primary" : "text-text-muted"}`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              <span className="truncate max-w-full">{name}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
};
