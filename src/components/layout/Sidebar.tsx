"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ShieldCheck, GitBranch, FileText, Settings,
  Cpu, Shield, Sparkles, CheckCircle2, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { name: "Repositories", href: "/repositories", icon: GitBranch, label: "AI Workspace" },
  { name: "Reports",      href: "/reports",      icon: FileText,  label: "Audit Reports" },
  { name: "Settings",     href: "/settings",     icon: Settings,  label: "Configuration" },
];

const ENGINE_STATUS = [
  { name: "CodeBERT",  icon: Cpu,      ok: true  },
  { name: "Bandit",    icon: Shield,   ok: true  },
  { name: "Pylint",    icon: Zap,      ok: true  },
  { name: "OpenAI",    icon: Sparkles, ok: true  },
];

export const Sidebar: React.FC = () => {
  const pathname = usePathname();

  return (
    <aside className="w-sidebar hidden md:flex flex-col bg-surface border-r border-border h-screen sticky top-0 z-30 select-none">

      {/* ── Brand ── */}
      <div className="h-topbar px-5 border-b border-border flex items-center gap-3 shrink-0">
        <div className="w-8 h-8 rounded-xl bg-primary/20 border border-primary/40 flex items-center justify-center">
          <ShieldCheck className="w-4 h-4 text-primary" />
        </div>
        <div className="leading-none">
          <h1 className="text-[15px] font-bold tracking-wider text-text-primary">
            BUG<span className="text-primary">ZERO</span>
          </h1>
          <span className="text-[10px] text-text-muted font-mono tracking-widest uppercase">
            AI Review Platform
          </span>
        </div>
      </div>

      {/* ── Nav label ── */}
      <div className="px-5 pt-5 pb-2">
        <span className="text-[10px] font-semibold text-text-muted uppercase tracking-widest">
          Navigation
        </span>
      </div>

      {/* ── Nav Items ── */}
      <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === "/repositories"
              ? pathname === "/repositories" || pathname.startsWith("/repositories/")
              : pathname.startsWith(item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all group relative",
                isActive
                  ? "bg-card border border-border text-white font-semibold shadow-sm"
                  : "text-text-secondary hover:text-text-primary hover:bg-surface-hover"
              )}
            >
              {/* Active indicator bar */}
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-primary rounded-r-full" />
              )}
              <Icon
                className={cn(
                  "w-4 h-4 shrink-0 transition-colors",
                  isActive ? "text-primary" : "text-text-muted group-hover:text-text-primary"
                )}
              />
              <div className="min-w-0">
                <span className="block text-[13px] leading-none mb-0.5">{item.name}</span>
                <span className="block text-[10px] text-text-muted leading-none">{item.label}</span>
              </div>
            </Link>
          );
        })}
      </nav>

      {/* ── AI Engine Status Card ── */}
      <div className="m-3 bg-card border border-border rounded-xl p-3 space-y-2.5 shrink-0">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-text-secondary uppercase tracking-wider">
            AI Engine
          </span>
          <span className="flex items-center gap-1 text-[10px] text-success font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse inline-block" />
            All Systems OK
          </span>
        </div>

        <div className="space-y-1.5">
          {ENGINE_STATUS.map((e) => {
            const Icon = e.icon;
            return (
              <div key={e.name} className="flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-1.5 text-text-secondary">
                  <Icon className="w-3 h-3 text-text-muted" />
                  <span>{e.name}</span>
                </div>
                <div className="flex items-center gap-1 text-success">
                  <CheckCircle2 className="w-3 h-3" />
                  <span className="font-mono text-[10px]">Active</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="px-5 py-3 border-t border-border text-[10px] text-text-muted font-mono flex items-center justify-between shrink-0">
        <span>v2.1.0-prod</span>
        <span className="text-success flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-success animate-ping inline-block" />
          Online
        </span>
      </div>
    </aside>
  );
};
