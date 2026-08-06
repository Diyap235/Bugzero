"use client";

import React, { useState } from "react";
import { UserPreferences } from "@/types";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface AppearanceSectionProps {
  preferences: UserPreferences;
  onSave: (prefs: UserPreferences) => Promise<void>;
}

const ACCENT_COLORS: { value: UserPreferences["accentColor"]; label: string; hex: string }[] = [
  { value: "green",  label: "Green",  hex: "#2E7D32" },
  { value: "blue",   label: "Blue",   hex: "#3B82F6" },
  { value: "purple", label: "Purple", hex: "#8B5CF6" },
  { value: "orange", label: "Orange", hex: "#F59E0B" },
];

export const AppearanceSection: React.FC<AppearanceSectionProps> = ({ preferences, onSave }) => {
  const [prefs, setPrefs]   = useState<UserPreferences>({ ...preferences });
  const [isSaving, setIs]   = useState(false);

  const handleSave = async () => {
    setIs(true);
    try { await onSave(prefs); } finally { setIs(false); }
  };

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h2 className="text-[18px] font-bold text-white">Appearance</h2>
        <p className="text-[13px] text-[#AAB5AF] mt-1">Customize the look and feel of the application.</p>
      </div>

      {/* Theme (dark only for now) */}
      <div>
        <label className="block text-[11px] font-semibold text-[#7E8A84] uppercase tracking-wider mb-3">
          Theme
        </label>
        <div className="flex gap-3">
          <div className="flex items-center gap-3 px-4 py-3 bg-[#0B120F] border-2 border-[#2E7D32] rounded-xl cursor-default">
            <div className="w-6 h-6 rounded-md bg-[#050705] border border-[#1E3025]" />
            <div>
              <p className="text-[13px] font-semibold text-white">Dark</p>
              <p className="text-[10px] text-[#7E8A84]">Active</p>
            </div>
          </div>
          <div className="flex items-center gap-3 px-4 py-3 bg-[#0B120F] border border-[#1E3025] rounded-xl opacity-40 cursor-not-allowed">
            <div className="w-6 h-6 rounded-md bg-gray-100 border border-gray-300" />
            <div>
              <p className="text-[13px] font-semibold text-white">Light</p>
              <p className="text-[10px] text-[#7E8A84]">Coming soon</p>
            </div>
          </div>
        </div>
      </div>

      {/* Accent color */}
      <div>
        <label className="block text-[11px] font-semibold text-[#7E8A84] uppercase tracking-wider mb-3">
          Accent Color
        </label>
        <div className="flex gap-3 flex-wrap">
          {ACCENT_COLORS.map((c) => (
            <button
              key={c.value}
              onClick={() => setPrefs((p) => ({ ...p, accentColor: c.value }))}
              className={cn(
                "flex items-center gap-2.5 px-4 py-2.5 rounded-xl border transition-all text-[12px] font-medium",
                prefs.accentColor === c.value
                  ? "border-white/40 bg-white/10 text-white"
                  : "border-[#1E3025] text-[#AAB5AF] hover:border-[#294134] hover:text-white"
              )}
            >
              <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ backgroundColor: c.hex }} />
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* Animations toggle */}
      <div>
        <label className="block text-[11px] font-semibold text-[#7E8A84] uppercase tracking-wider mb-3">
          Animations
        </label>
        <div className="flex items-center justify-between px-5 py-4 bg-[#101915] border border-[#1E3025] rounded-2xl">
          <div>
            <p className="text-[13px] font-semibold text-white">Enable Animations</p>
            <p className="text-[12px] text-[#7E8A84]">Page transitions, hover effects, and motion.</p>
          </div>
          <button
            onClick={() => setPrefs((p) => ({ ...p, animationsEnabled: !p.animationsEnabled }))}
            className={cn(
              "relative inline-flex h-6 w-11 rounded-full transition-colors duration-200 shrink-0",
              prefs.animationsEnabled ? "bg-[#2E7D32]" : "bg-[#1E3025]"
            )}
            role="switch"
            aria-checked={prefs.animationsEnabled}
          >
            <span className={cn(
              "absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all duration-200",
              prefs.animationsEnabled ? "left-6" : "left-1"
            )} />
          </button>
        </div>
      </div>

      <div className="flex justify-end">
        <motion.button
          whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center gap-2 h-10 px-6 bg-[#2E7D32] hover:bg-[#388E3C] disabled:opacity-50 text-white text-[13px] font-bold rounded-xl transition-all"
        >
          {isSaving ? "Saving…" : "Save Appearance"}
        </motion.button>
      </div>
    </div>
  );
};
