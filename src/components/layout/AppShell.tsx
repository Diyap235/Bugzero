"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Activity, BarChart3, FileText, GitBranch, History, Search, Settings } from "lucide-react";
import { useAuth } from "@/lib/auth/auth-context";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

interface AppShellProps {
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  const pathname = usePathname();
  const router = useRouter();
  const auth = useAuth();
  const navigation = [
    { name: "Overview", href: "/dashboard", icon: Activity },
    { name: "Repositories", href: "/repositories", icon: GitBranch },
    { name: "Findings", href: "/findings", icon: Search },
    { name: "Health", href: "/health", icon: BarChart3 },
    { name: "History", href: "/history", icon: History },
    { name: "Reports", href: "/reports", icon: FileText },
    { name: "Settings", href: "/settings", icon: Settings },
  ];
  React.useEffect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      const destination = auth.sessionExpired ? "/login?expired=1" : "/login";
      router.replace(destination);
    }
  }, [auth.isAuthenticated, auth.isLoading, auth.sessionExpired, router]);

  if (auth.isLoading || !auth.isAuthenticated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4 text-sm text-text-muted" role="status">
        {auth.sessionExpired ? "Your session expired. Returning to sign in…" : "Checking your session…"}
      </main>
    );
  }

  return (
    <div className="min-h-screen flex bg-background text-text-primary">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar />
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1600px] w-full mx-auto pb-24 md:pb-8">
          {children}
        </main>
      </div>
      <nav aria-label="Mobile navigation" className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-surface border-t border-border grid grid-cols-7">
        {navigation.map(({ name, href, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
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
