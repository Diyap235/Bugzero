"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Search, User as UserIcon, LogOut, ChevronDown, GitBranch } from "lucide-react";
import { MOCK_REPOSITORIES, MOCK_USER } from "@/lib/mock-data";

export const Topbar: React.FC = () => {
  const router = useRouter();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [repoDropdownOpen, setRepoDropdownOpen] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState(MOCK_REPOSITORIES[0]);

  const handleSelectRepo = (repo: typeof MOCK_REPOSITORIES[0]) => {
    setSelectedRepo(repo);
    setRepoDropdownOpen(false);
    router.push(`/repositories/${repo.id}`);
  };

  return (
    <header className="h-topbar bg-surface/80 backdrop-blur-md border-b border-border px-6 flex items-center justify-between sticky top-0 z-20">
      {/* Left: Repository Quick Selector */}
      <div className="relative">
        <button
          onClick={() => setRepoDropdownOpen(!repoDropdownOpen)}
          className="flex items-center gap-2 px-3 py-2 rounded-button border border-border bg-card hover:bg-surface-hover text-sm font-medium text-text-primary transition-all"
        >
          <GitBranch className="w-4 h-4 text-primary" />
          <span>{selectedRepo.name}</span>
          <ChevronDown className="w-4 h-4 text-text-muted" />
        </button>

        {repoDropdownOpen && (
          <div className="absolute left-0 mt-2 w-64 bg-card border border-border rounded-card shadow-2xl p-2 z-30 space-y-1 animate-in fade-in zoom-in-95 duration-100">
            <div className="px-3 py-1.5 text-[11px] font-semibold text-text-muted uppercase">Select Repository</div>
            {MOCK_REPOSITORIES.map((repo) => (
              <button
                key={repo.id}
                onClick={() => handleSelectRepo(repo)}
                className="w-full text-left px-3 py-2 rounded-lg text-xs hover:bg-surface-hover flex items-center justify-between text-text-primary transition-colors"
              >
                <span className="font-medium truncate">{repo.name}</span>
                <span className="text-[10px] text-primary font-mono font-semibold">{repo.healthScore}% Health</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Center: Global Search Bar */}
      <div className="hidden md:flex items-center max-w-md w-full mx-6">
        <div className="relative w-full">
          <Search className="w-4 h-4 absolute left-3.5 top-3 text-text-muted pointer-events-none" />
          <input
            type="text"
            placeholder="Quick search findings, code, reports... (Press /)"
            className="w-full h-10 bg-card border border-border rounded-input pl-10 pr-4 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary transition-colors"
          />
        </div>
      </div>

      {/* Right: Notifications & User Profile */}
      <div className="flex items-center gap-3">
        <button
          className="p-2 rounded-button border border-border bg-card hover:bg-surface-hover text-text-secondary hover:text-text-primary transition-colors relative"
          title="Notifications"
        >
          <Bell className="w-4 h-4" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-primary rounded-full animate-pulse" />
        </button>

        {/* User Menu */}
        <div className="relative">
          <button
            onClick={() => setUserMenuOpen(!userMenuOpen)}
            className="flex items-center gap-2 p-1.5 rounded-button border border-border bg-card hover:bg-surface-hover transition-all"
          >
            <div className="w-7 h-7 rounded-full bg-primary/30 text-primary border border-primary/50 flex items-center justify-center font-bold text-xs">
              {MOCK_USER.name.charAt(0)}
            </div>
            <span className="hidden sm:inline text-xs font-semibold text-text-primary">{MOCK_USER.name}</span>
            <ChevronDown className="w-3.5 h-3.5 text-text-muted" />
          </button>

          {userMenuOpen && (
            <div className="absolute right-0 mt-2 w-52 bg-card border border-border rounded-card shadow-2xl p-2 z-30 space-y-1 animate-in fade-in zoom-in-95 duration-100">
              <div className="px-3 py-2 border-b border-border mb-1">
                <div className="text-xs font-semibold text-text-primary">{MOCK_USER.name}</div>
                <div className="text-[11px] text-text-secondary truncate">{MOCK_USER.email}</div>
              </div>
              <Link
                href="/settings"
                onClick={() => setUserMenuOpen(false)}
                className="w-full text-left px-3 py-2 rounded-lg text-xs hover:bg-surface-hover flex items-center gap-2 text-text-primary transition-colors"
              >
                <UserIcon className="w-3.5 h-3.5 text-text-muted" />
                <span>Account Settings</span>
              </Link>
              <Link
                href="/login"
                onClick={() => setUserMenuOpen(false)}
                className="w-full text-left px-3 py-2 rounded-lg text-xs hover:bg-surface-hover flex items-center gap-2 text-danger transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
