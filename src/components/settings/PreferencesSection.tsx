"use client";

import React, { useState } from "react";
import { UserPreferences } from "@/types";
import { Button } from "@/components/shared/Button";
import { Save } from "lucide-react";
import { cn } from "@/lib/utils";

interface PreferencesSectionProps {
  preferences: UserPreferences;
  onSave: (prefs: UserPreferences) => Promise<void>;
}

export const PreferencesSection: React.FC<PreferencesSectionProps> = ({
  preferences,
  onSave,
}) => {
  const [prefs, setPrefs] = useState<UserPreferences>({ ...preferences });
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(prefs);
    } finally {
      setIsSaving(false);
    }
  };

  const Toggle: React.FC<{
    label: string;
    description: string;
    checked: boolean;
    onToggle: () => void;
  }> = ({ label, description, checked, onToggle }) => (
    <div className="flex items-center justify-between py-4 border-b border-border last:border-0">
      <div>
        <span className="text-sm font-semibold text-text-primary block">{label}</span>
        <span className="text-xs text-text-secondary">{description}</span>
      </div>
      <button
        onClick={onToggle}
        className={cn(
          "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none",
          checked ? "bg-primary" : "bg-surface-hover border border-border"
        )}
        role="switch"
        aria-checked={checked}
        type="button"
      >
        <span
          className={cn(
            "inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow",
            checked ? "translate-x-6" : "translate-x-1"
          )}
        />
      </button>
    </div>
  );

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h2 className="text-lg font-bold text-text-primary">App Preferences</h2>
        <p className="text-xs text-text-secondary mt-1">
          Customize how BugZero behaves in your workflow.
        </p>
      </div>

      {/* Select preferences */}
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-semibold text-text-secondary uppercase mb-1.5">
            Default AI Explanation Level
          </label>
          <select
            value={prefs.defaultExplanationLevel}
            onChange={(e) =>
              setPrefs((p) => ({
                ...p,
                defaultExplanationLevel: e.target.value as UserPreferences["defaultExplanationLevel"],
              }))
            }
            className="w-full h-[48px] bg-surface border border-border rounded-input px-4 text-text-primary focus:outline-none focus:border-primary text-sm transition-colors"
          >
            <option value="Basic">Basic — Quick summary for triage</option>
            <option value="Detailed">Detailed — Full root cause and fix (recommended)</option>
            <option value="Deep">Deep — Research-level security analysis</option>
          </select>
          <p className="text-[11px] text-text-muted mt-1 pl-1">
            Controls the depth of CodeBERT + LLM explanations shown in the finding drawer.
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-text-secondary uppercase mb-1.5">
            Default Export Format
          </label>
          <select
            value={prefs.defaultReportFormat}
            onChange={(e) =>
              setPrefs((p) => ({
                ...p,
                defaultReportFormat: e.target.value as UserPreferences["defaultReportFormat"],
              }))
            }
            className="w-full h-[48px] bg-surface border border-border rounded-input px-4 text-text-primary focus:outline-none focus:border-primary text-sm transition-colors"
          >
            <option value="PDF">PDF — Professional audit-ready document</option>
            <option value="JSON">JSON — Machine-readable data export</option>
          </select>
        </div>
      </div>

      {/* Toggle preferences */}
      <div className="bg-card border border-border rounded-card px-4">
        <Toggle
          label="Auto-Open Finding Drawer"
          description="Automatically open the detail drawer when clicking a finding in the table."
          checked={prefs.autoOpenDrawer}
          onToggle={() => setPrefs((p) => ({ ...p, autoOpenDrawer: !p.autoOpenDrawer }))}
        />
        <Toggle
          label="Enable Keyboard Shortcuts"
          description="Use / to focus search, Esc to close drawers, and other shortcuts throughout the app."
          checked={prefs.enableKeyboardShortcuts}
          onToggle={() =>
            setPrefs((p) => ({ ...p, enableKeyboardShortcuts: !p.enableKeyboardShortcuts }))
          }
        />
      </div>

      <div className="flex justify-end">
        <Button
          variant="primary"
          isLoading={isSaving}
          onClick={handleSave}
          leftIcon={<Save className="w-4 h-4" />}
        >
          Save Preferences
        </Button>
      </div>
    </div>
  );
};
