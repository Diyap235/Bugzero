"use client";

import React, { useState, useEffect } from "react";
import { User, Palette, Bell, ChevronRight, Info } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { AppShell } from "@/components/layout/AppShell";
import { ProfileSection } from "@/components/settings/ProfileSection";
import { AppearanceSection } from "@/components/settings/AppearanceSection";
import { NotificationsSection } from "@/components/settings/NotificationsSection";
import { Toast, ToastMessage } from "@/components/shared/Toast";
import { authService } from "@/services/auth.service";
import { userService } from "@/services/user.service";
import { UserProfile } from "@/types";
import { cn } from "@/lib/utils";

type Tab = "profile" | "appearance" | "notifications" | "about";

const NAV: { id: Tab; label: string; desc: string; icon: React.ElementType }[] = [
  { id: "profile",       label: "Profile",       desc: "Name, email & password",   icon: User    },
  { id: "appearance",    label: "Appearance",     desc: "Theme & animations",        icon: Palette },
  { id: "notifications", label: "Notifications",  desc: "Alerts & emails",           icon: Bell    },
  { id: "about",         label: "About",          desc: "Version & info",            icon: Info    },
];

function AboutSection() {
  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h2 className="text-[18px] font-bold text-white">About BugZero</h2>
        <p className="text-[13px] text-[#AAB5AF] mt-1">Version information and resources.</p>
      </div>
      <div className="bg-[#101915] border border-[#1E3025] rounded-2xl divide-y divide-[#1E3025]">
        {[
          { label: "Version",         value: "2.1.0"          },
          { label: "Release Date",    value: "August 2026"    },
          { label: "License",         value: "MIT"            },
        ].map((row) => (
          <div key={row.label} className="flex items-center justify-between px-5 py-4">
            <span className="text-[13px] text-[#AAB5AF]">{row.label}</span>
            <span className="text-[13px] font-semibold text-white font-mono">{row.value}</span>
          </div>
        ))}
        <div className="flex items-center justify-between px-5 py-4">
          <span className="text-[13px] text-[#AAB5AF]">GitHub</span>
          <a
            href="https://github.com"
            target="_blank"
            rel="noreferrer"
            className="text-[13px] font-semibold text-[#2E7D32] hover:text-[#4CAF50] transition-colors"
          >
            View Repository →
          </a>
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("profile");
  const [user, setUser]           = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [toast, setToast]         = useState<ToastMessage | null>(null);

  useEffect(() => {
    userService.getCurrentUser().then((u) => { setUser(u); setIsLoading(false); });
  }, []);

  const showToast = (message: string, type: ToastMessage["type"] = "success") =>
    setToast({ id: Date.now().toString(), type, message });

  const handleProfileSave = async (updates: { name: string; currentPassword?: string; newPassword?: string }) => {
    try {
      if (updates.currentPassword && updates.newPassword) {
        await authService.changePassword(updates.currentPassword, updates.newPassword);
      }
      const updated = await authService.updateProfile({ name: updates.name });
      setUser(updated);
      showToast("Profile saved.");
    } catch (e: unknown) {
      showToast(e instanceof Error ? e.message : "Failed to save profile.", "danger");
    }
  };

  const handlePrefsSave = async (prefs: UserProfile["preferences"]) => {
    try {
      const updated = await authService.updatePreferences(prefs);
      setUser(updated);
      showToast("Preferences saved.");
    } catch {
      showToast("Failed to save preferences.", "danger");
    }
  };

  return (
    <AppShell>
      <div className="space-y-6">

        {/* Identity hero */}
        {!isLoading && user && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            className="relative overflow-hidden bg-[#101915] border border-[#1E3025] rounded-2xl p-5"
          >
            <div
              className="absolute top-0 right-0 w-48 h-24 pointer-events-none opacity-[0.06]"
              style={{ background: "radial-gradient(ellipse, #2E7D32, transparent 70%)", transform: "translate(20%,-30%)" }}
            />
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-[#2E7D32]/25 border-2 border-[#2E7D32]/40 flex items-center justify-center text-[#2E7D32] font-bold text-xl shrink-0 select-none">
                {user.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[16px] font-bold text-white">{user.name}</p>
                <p className="text-[12px] text-[#7E8A84]">{user.email}</p>
              </div>
              <div className="px-3 py-1.5 bg-[#0B120F] border border-[#1E3025] rounded-xl text-[10px] font-mono text-[#7E8A84] shrink-0">
                v2.1.0
              </div>
            </div>
          </motion.div>
        )}

        <div className="flex flex-col lg:flex-row gap-5">
          {/* Settings nav */}
          <aside className="lg:w-56 shrink-0 space-y-0.5">
            {NAV.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all relative",
                    isActive
                      ? "bg-[#101915] border border-[#1E3025] text-white"
                      : "text-[#AAB5AF] hover:bg-[#0B120F] hover:text-white"
                  )}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-[#2E7D32] rounded-r-full" />
                  )}
                  <Icon className={cn("w-4 h-4 shrink-0", isActive ? "text-[#2E7D32]" : "text-[#7E8A84]")} />
                  <div className="flex-1 min-w-0">
                    <p className={cn("text-[13px]", isActive ? "font-bold" : "font-medium")}>{item.label}</p>
                    <p className="text-[11px] text-[#7E8A84] truncate">{item.desc}</p>
                  </div>
                  <ChevronRight className={cn("w-3.5 h-3.5 shrink-0", isActive ? "text-[#7E8A84]" : "text-transparent")} />
                </button>
              );
            })}
          </aside>

          {/* Content panel */}
          <div className="flex-1 min-w-0 bg-[#101915] border border-[#1E3025] rounded-2xl p-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
              >
                {!isLoading && user && (
                  <>
                    {activeTab === "profile"       && <ProfileSection       user={user}                    onSave={handleProfileSave}                     />}
                    {activeTab === "appearance"    && <AppearanceSection    preferences={user.preferences} onSave={handlePrefsSave}                        />}
                    {activeTab === "notifications" && <NotificationsSection preferences={user.preferences} onSave={handlePrefsSave}                        />}
                    {activeTab === "about"         && <AboutSection />}
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </AppShell>
  );
}
