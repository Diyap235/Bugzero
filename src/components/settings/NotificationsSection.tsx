"use client";

import React, { useState } from "react";
import { UserPreferences } from "@/types";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface NotificationsSectionProps {
  preferences: UserPreferences;
  onSave: (prefs: UserPreferences) => Promise<void>;
}

export const NotificationsSection: React.FC<NotificationsSectionProps> = ({ preferences, onSave }) => {
  const [prefs, setPrefs] = useState<UserPreferences>({ ...preferences });
  const [isSaving, setIs] = useState(false);

  const toggle = (key: keyof Pick<UserPreferences, "browserNotifications" | "notifyOnReview" | "notifyOnCritical">) =>
    setPrefs((p) => ({ ...p, [key]: !p[key] }));

  const handleSave = async () => {
    setIs(true);
    try { await onSave(prefs); } finally { setIs(false); }
  };

  const rows: { key: keyof typeof prefs; label: string; desc: string; disabled?: boolean }[] = [
    {
      key: "browserNotifications",
      label: "Browser Notifications",
      desc: "Receive push notifications in your browser while the app is open.",
    },
    {
      key: "notifyOnReview",
      label: "Review Completed",
      desc: "Notify when an AI review finishes running.",
    },
    {
      key: "notifyOnCritical",
      label: "Critical Finding Detected",
      desc: "Alert immediately when a critical severity issue is found.",
    },
  ];

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h2 className="text-[18px] font-bold text-white">Notifications</h2>
        <p className="text-[13px] text-[#AAB5AF] mt-1">Choose when BugZero alerts you.</p>
      </div>

      <div className="bg-[#101915] border border-[#1E3025] rounded-2xl divide-y divide-[#1E3025]">
        {rows.map(({ key, label, desc }) => (
          <div key={key} className="flex items-center justify-between px-5 py-4">
            <div className="pr-4">
              <p className="text-[13px] font-semibold text-white">{label}</p>
              <p className="text-[12px] text-[#7E8A84]">{desc}</p>
            </div>
            <button
              onClick={() => toggle(key as Parameters<typeof toggle>[0])}
              className={cn(
                "relative inline-flex h-6 w-11 rounded-full transition-colors duration-200 shrink-0",
                prefs[key] ? "bg-[#2E7D32]" : "bg-[#1E3025]"
              )}
              role="switch"
              aria-checked={!!prefs[key]}
            >
              <span
                className={cn(
                  "absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all duration-200",
                  prefs[key] ? "left-6" : "left-1"
                )}
              />
            </button>
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <motion.button
          whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center gap-2 h-10 px-6 bg-[#2E7D32] hover:bg-[#388E3C] disabled:opacity-50 text-white text-[13px] font-bold rounded-xl transition-all"
        >
          {isSaving ? "Saving…" : "Save Notifications"}
        </motion.button>
      </div>
    </div>
  );
};
