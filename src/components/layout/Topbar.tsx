"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bell, Search, User as UserIcon, LogOut, ChevronDown,
  GitBranch, CheckCircle2, ShieldAlert, X,
} from "lucide-react";
import { authStore } from "@/lib/auth-store";
import { authService } from "@/services/auth.service";
import { MOCK_REPOSITORIES } from "@/lib/mock-data";
import { UserProfile } from "@/types";

interface Notification {
  id: string;
  type: "success" | "warning";
  title: string;
  body: string;
  time: string;
  read: boolean;
}

const INITIAL_NOTIFICATIONS: Notification[] = [
  { id: "n1", type: "success", title: "Review completed",     body: "auth-service-python — 4 findings detected", time: "2 min ago",  read: false },
  { id: "n2", type: "warning", title: "Critical finding",     body: "SQL injection risk in user_repo.py:48",      time: "2 min ago",  read: false },
  { id: "n3", type: "success", title: "Report exported",      body: "auth-service-security-audit.pdf ready",     time: "1 day ago",  read: true  },
];

export const Topbar: React.FC = () => {
  const router = useRouter();

  const [user, setUser]                     = useState<UserProfile | null>(null);
  const [userMenuOpen, setUserMenuOpen]     = useState(false);
  const [repoDropOpen, setRepoDropOpen]     = useState(false);
  const [notifOpen, setNotifOpen]           = useState(false);
  const [notifications, setNotifications]   = useState<Notification[]>(INITIAL_NOTIFICATIONS);
  const [selectedRepo, setSelectedRepo]     = useState(MOCK_REPOSITORIES[0]);

  const notifRef = useRef<HTMLDivElement>(null);
  const userRef  = useRef<HTMLDivElement>(null);
  const repoRef  = useRef<HTMLDivElement>(null);

  // Load persisted user
  useEffect(() => {
    const u = authStore.getUser();
    if (u) setUser(u);
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
      if (userRef.current  && !userRef.current.contains(e.target as Node))  setUserMenuOpen(false);
      if (repoRef.current  && !repoRef.current.contains(e.target as Node))  setRepoDropOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAllRead = () => setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  const dismiss = (id: string) => setNotifications((prev) => prev.filter((n) => n.id !== id));

  const handleLogout = async () => {
    await authService.logout();
    router.push("/login");
  };

  const handleSelectRepo = (repo: typeof MOCK_REPOSITORIES[0]) => {
    setSelectedRepo(repo);
    setRepoDropOpen(false);
    router.push(`/repositories/${repo.id}`);
  };

  const displayName = user?.name ?? "Alex Vance";
  const initials    = displayName.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  return (
    <header className="h-topbar bg-surface/80 backdrop-blur-md border-b border-border px-6 flex items-center justify-between sticky top-0 z-20">

      {/* Left: Repo quick selector */}
      <div className="relative" ref={repoRef}>
        <button
          onClick={() => setRepoDropOpen((v) => !v)}
          className="flex items-center gap-2 px-3 py-2 rounded-button border border-border bg-card hover:bg-surface-hover text-sm font-medium text-text-primary transition-all"
        >
          <GitBranch className="w-4 h-4 text-primary" />
          <span className="hidden sm:inline max-w-[180px] truncate">{selectedRepo.name}</span>
          <ChevronDown className="w-4 h-4 text-text-muted" />
        </button>

        {repoDropOpen && (
          <div className="absolute left-0 mt-2 w-64 bg-card border border-border rounded-card shadow-2xl p-2 z-30 space-y-0.5">
            <p className="px-3 py-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
              Switch Repository
            </p>
            {MOCK_REPOSITORIES.map((repo) => (
              <button
                key={repo.id}
                onClick={() => handleSelectRepo(repo)}
                className="w-full text-left px-3 py-2 rounded-lg text-[12px] hover:bg-surface-hover flex items-center justify-between text-text-primary transition-colors"
              >
                <span className="font-medium truncate">{repo.name}</span>
                <span
                  className={`text-[10px] font-mono font-bold ${
                    repo.healthScore >= 80 ? "text-success" : repo.healthScore >= 60 ? "text-warning" : "text-danger"
                  }`}
                >
                  {repo.healthScore}%
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Center: Search */}
      <div className="hidden md:flex items-center max-w-md w-full mx-6">
        <div className="relative w-full">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
          <input
            type="text"
            placeholder="Search repositories, findings… (Press /)"
            className="w-full h-10 bg-card border border-border rounded-input pl-10 pr-4 text-[12px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary transition-colors"
          />
        </div>
      </div>

      {/* Right: Notifications + User */}
      <div className="flex items-center gap-2">

        {/* Notifications */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => setNotifOpen((v) => !v)}
            className="relative p-2 rounded-button border border-border bg-card hover:bg-surface-hover text-text-secondary hover:text-text-primary transition-colors"
            title="Notifications"
            aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-danger text-white text-[9px] font-bold rounded-full flex items-center justify-center leading-none">
                {unreadCount}
              </span>
            )}
          </button>

          {notifOpen && (
            <div className="absolute right-0 mt-2 w-80 bg-card border border-border rounded-card shadow-2xl z-30 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <span className="text-[13px] font-semibold text-text-primary">Notifications</span>
                {unreadCount > 0 && (
                  <button onClick={markAllRead} className="text-[11px] text-primary hover:text-primary-hover transition-colors">
                    Mark all read
                  </button>
                )}
              </div>

              {notifications.length === 0 ? (
                <div className="px-4 py-8 text-center text-[12px] text-text-muted">
                  No notifications
                </div>
              ) : (
                <div className="divide-y divide-border max-h-64 overflow-y-auto">
                  {notifications.map((n) => (
                    <div
                      key={n.id}
                      className={`flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface-hover ${!n.read ? "bg-surface/50" : ""}`}
                    >
                      <div className={`mt-0.5 shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${n.type === "success" ? "bg-success/15" : "bg-warning/15"}`}>
                        {n.type === "success"
                          ? <CheckCircle2 className="w-3.5 h-3.5 text-success" />
                          : <ShieldAlert className="w-3.5 h-3.5 text-warning" />
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-[12px] font-semibold leading-tight ${n.read ? "text-text-secondary" : "text-text-primary"}`}>
                          {n.title}
                        </p>
                        <p className="text-[11px] text-text-muted mt-0.5 truncate">{n.body}</p>
                        <p className="text-[10px] text-text-muted mt-1 font-mono">{n.time}</p>
                      </div>
                      <button
                        onClick={() => dismiss(n.id)}
                        className="shrink-0 p-1 rounded text-text-muted hover:text-text-primary transition-colors"
                        title="Dismiss"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* User menu */}
        <div className="relative" ref={userRef}>
          <button
            onClick={() => setUserMenuOpen((v) => !v)}
            className="flex items-center gap-2 p-1.5 rounded-button border border-border bg-card hover:bg-surface-hover transition-all"
          >
            <div className="w-7 h-7 rounded-full bg-primary/30 text-primary border border-primary/50 flex items-center justify-center font-bold text-[11px] select-none">
              {initials}
            </div>
            <span className="hidden sm:inline text-[12px] font-semibold text-text-primary max-w-[100px] truncate">
              {displayName}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-text-muted" />
          </button>

          {userMenuOpen && (
            <div className="absolute right-0 mt-2 w-52 bg-card border border-border rounded-card shadow-2xl p-2 z-30 space-y-0.5">
              <div className="px-3 py-2 border-b border-border mb-1">
                <p className="text-[12px] font-semibold text-text-primary truncate">{displayName}</p>
                <p className="text-[10px] text-text-muted truncate">{user?.email ?? ""}</p>
              </div>
              <Link
                href="/settings"
                onClick={() => setUserMenuOpen(false)}
                className="w-full text-left px-3 py-2 rounded-lg text-[12px] hover:bg-surface-hover flex items-center gap-2 text-text-primary transition-colors"
              >
                <UserIcon className="w-3.5 h-3.5 text-text-muted" />
                Account Settings
              </Link>
              <button
                onClick={handleLogout}
                className="w-full text-left px-3 py-2 rounded-lg text-[12px] hover:bg-surface-hover flex items-center gap-2 text-danger transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
