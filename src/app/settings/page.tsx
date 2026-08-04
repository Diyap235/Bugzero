"use client";

import React, { useState, useEffect } from "react";
import { User, Settings2, Sparkles, Bell, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { AppShell } from "@/components/layout/AppShell";
import { ProfileSection } from "@/components/settings/ProfileSection";
import { PreferencesSection } from "@/components/settings/PreferencesSection";
import { AIProviderSection } from "@/components/settings/AIProviderSection";
import { Toast, ToastMessage } from "@/components/shared/Toast";
import { userService } from "@/services/user.service";
import { UserProfile } from "@/types";
import { cn } from "@/lib/utils";

type SettingsTab = "profile" | "preferences" | "ai-provider" | "notifications";

const NAV: { id: SettingsTab; label: string; desc: string; icon: React.ElementType }[] = [
  { id: "profile",      label: "Profile",       desc: "Name, email, organization",       icon: User      },
  { id: "preferences",  label: "Preferences",   desc: "Behavior & defaults",              icon: Settings2 },
  { id: "ai-provider",  label: "AI Provider",   desc: "LLM model & explanation level",   icon: Sparkles  },
  { id: "notifications",label: "Notifications", desc: "Alerts & email settings",          icon: Bell      },
];

function NotificationsSection() {
  const [prefs, setPrefs] = useState({ onReview: true, onCritical: true, onReport: false, weeklyDigest: true });
  const [saved, setSaved] = useState(false);

  const save = () => { setSaved(true); setTimeout(() => setSaved(false), 2000); };

  const Toggle = ({ k, label, desc }: { k: keyof typeof prefs; label: string; desc: string }) => (
    <div className="flex items-center justify-between py-4 border-b border-[#1E3025] last:border-0">
      <div>
        <p className="text-[13px] font-semibold text-white">{label}</p>
        <p className="text-[12px] text-[#7E8A84]">{desc}</p>
      </div>
      <button
        onClick={() => setPrefs((p) => ({ ...p, [k]: !p[k] }))}
        className={cn(
          "relative inline-flex h-6 w-11 rounded-full transition-colors duration-200",
          prefs[k] ? "bg-[#2E7D32]" : "bg-[#1E3025]"
        )}
        role="switch" aria-checked={prefs[k]}
      >
        <span className={cn("absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all duration-200", prefs[k] ? "left-6" : "left-1")} />
      </button>
    </div>
  );

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h2 className="text-[18px] font-bold text-white">Notification Preferences</h2>
        <p className="text-[13px] text-[#AAB5AF] mt-1">Choose when BugZero notifies you.</p>
      </div>
      <div className="bg-[#101915] border border-[#1E3025] rounded-2xl px-5">
        <Toggle k="onReview"      label="Review Completed"       desc="Notify when an AI review finishes." />
        <Toggle k="onCritical"    label="Critical Finding"       desc="Alert immediately on critical severity." />
        <Toggle k="onReport"      label="Report Exported"        desc="Notify when an audit report is ready." />
        <Toggle k="weeklyDigest"  label="Weekly Health Digest"   desc="Receive a weekly summary of repository health." />
      </div>
      <div className="flex justify-end">
        <motion.button
          whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
          onClick={save}
          className={cn(
            "flex items-center gap-2 h-10 px-6 rounded-xl text-[13px] font-bold transition-all",
            saved ? "bg-[#4CAF50] text-white" : "bg-[#2E7D32] hover:bg-[#388E3C] text-white"
          )}
        >
          {saved ? "✓ Saved" : "Save Notifications"}
        </motion.button>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");
  const [user, setUser]           = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [toast, setToast]         = useState<ToastMessage | null>(null);

  useEffect(() => {
    userService.getCurrentUser().then((u) => { setUser(u); setIsLoading(false); });
  }, []);

  const handleProfileSave = async (name: string, org: string) => {
    const u = await userService.updateProfile(name, org);
    setUser(u);
    setToast({ id: Date.now().toString(), type: "success", message: "Profile updated." });
  };
  const handlePrefsSave = async (prefs: UserProfile["preferences"]) => {
    const u = await userService.updatePreferences(prefs);
    setUser(u);
    setToast({ id: Date.now().toString(), type: "success", message: "Preferences saved." });
  };
  const handleAISave = async (config: UserProfile["aiProvider"]) => {
    const u = await userService.updateAIProvider(config);
    setUser(u);
    setToast({ id: Date.now().toString(), type: "success", message: "AI provider updated." });
  };

  return (
    <AppShell>
      <div className="space-y-6">

        {/* ── Identity Hero ── */}
        {!isLoading && user && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="relative overflow-hidden bg-[#101915] border border-[#1E3025] rounded-2xl p-6"
          >
            <div className="absolute top-0 right-0 w-48 h-24 pointer-events-none opacity-[0.06]"
              style={{ background: "radial-gradient(ellipse, #2E7D32, transparent 70%)", transform: "translate(20%, -30%)" }}
            />
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              {/* Avatar */}
              <div className="w-14 h-14 rounded-2xl bg-[#2E7D32]/25 border-2 border-[#2E7D32]/40 flex items-center justify-center text-[#2E7D32] font-bold text-2xl shrink-0 select-none">
                {user.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-[18px] font-bold text-white">{user.name}</h2>
                <p className="text-[12px] text-[#7E8A84]">{user.email}</p>
                {user.organization && (
                  <p className="text-[11px] text-[#AAB5AF] mt-0.5">{user.organization}</p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <div className="px-3 py-1.5 bg-[#2E7D32]/15 border border-[#2E7D32]/30 rounded-xl text-[11px] font-mono text-[#4CAF50]">
                  {user.aiProvider.provider} · {user.aiProvider.model}
                </div>
                <div className="px-3 py-1.5 bg-[#0B120F] border border-[#1E3025] rounded-xl text-[11px] font-mono text-[#7E8A84]">
                  v2.1.0-prod
                </div>
              </div>
            </div>
          </motion.div>
        )}

        <div className="flex flex-col lg:flex-row gap-6">
          {/* ── Settings Nav ── */}
          <aside className="lg:w-60 shrink-0 space-y-1">
            {NAV.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all group relative",
                    isActive
                      ? "bg-[#101915] border border-[#1E3025] text-white"
                      : "text-[#AAB5AF] hover:bg-[#0B120F] hover:text-white"
                  )}
                >
                  {isActive && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-[#2E7D32] rounded-r-full" />}
                  <Icon className={cn("w-4 h-4 shrink-0", isActive ? "text-[#2E7D32]" : "text-[#7E8A84] group-hover:text-[#AAB5AF]")} />
                  <div className="flex-1 min-w-0">
                    <p className={cn("text-[13px]", isActive ? "font-bold" : "font-medium")}>{item.label}</p>
                    <p className="text-[11px] text-[#7E8A84] truncate">{item.desc}</p>
                  </div>
                  <ChevronRight className={cn("w-3.5 h-3.5 shrink-0 transition-colors", isActive ? "text-[#7E8A84]" : "text-transparent group-hover:text-[#7E8A84]")} />
                </button>
              );
            })}
          </aside>

          {/* ── Settings Content ── */}
          <div className="flex-1 min-w-0 bg-[#101915] border border-[#1E3025] rounded-2xl p-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              >
                {!isLoading && user && (
                  <>
                    {activeTab === "profile"       && <ProfileSection user={user} onSave={handleProfileSave} />}
                    {activeTab === "preferences"   && <PreferencesSection preferences={user.preferences} onSave={handlePrefsSave} />}
                    {activeTab === "ai-provider"   && <AIProviderSection aiProvider={user.aiProvider} onSave={handleAISave} />}
                    {activeTab === "notifications" && <NotificationsSection />}
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
