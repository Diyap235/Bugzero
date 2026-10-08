"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity, BarChart3, FileText, GitBranch, History, Search,
  Settings, ShieldCheck,
} from "lucide-react";

const NAV_ITEMS = [
  { name: "Overview", href: "/dashboard", icon: Activity },
  { name: "Repositories", href: "/repositories", icon: GitBranch },
  { name: "Findings", href: "/findings", icon: Search },
  { name: "Health", href: "/health", icon: BarChart3 },
  { name: "History", href: "/history", icon: History },
  { name: "Reports", href: "/reports", icon: FileText },
  { name: "Settings", href: "/settings", icon: Settings },
];

export const Sidebar: React.FC = () => {
  const pathname = usePathname();

  return (
    <aside className="w-60 shrink-0 hidden md:flex flex-col bg-surface border-r border-border h-screen sticky top-0 z-30">
      <Link href="/dashboard" className="h-16 px-5 border-b border-border flex items-center gap-3 shrink-0" aria-label="BugZero overview">
        <div className="w-8 h-8 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center">
          <ShieldCheck className="w-4 h-4 text-primary" aria-hidden="true" />
        </div>
        <div className="leading-none">
          <span className="text-sm font-bold tracking-wide text-white">BUG<span className="text-primary">ZERO</span></span>
          <span className="block text-[10px] text-text-muted font-mono tracking-widest uppercase mt-1">Code Intelligence</span>
        </div>
      </Link>
      <nav aria-label="Primary navigation" className="flex-1 px-3 py-5 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;

          return (
            <Link
              key={item.name}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                isActive ? "bg-card border border-border text-white font-semibold" : "text-text-secondary hover:text-white hover:bg-surface-hover"
              }`}
            >
              <Icon
                className={`w-4 h-4 shrink-0 ${isActive ? "text-primary" : "text-text-muted"}`}
                aria-hidden="true"
              />
              <span className="text-[13px]">{item.name}</span>
            </Link>
          );
        })}
      </nav>
      <div className="px-5 py-4 border-t border-border text-[10px] text-text-muted font-mono">
        Repository intelligence
      </div>
    </aside>
  );
};
