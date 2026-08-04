"use client";

import React, { useState } from "react";
import { AIProviderConfig } from "@/types";
import { Button } from "@/components/shared/Button";
import { Save, Sparkles, ShieldCheck, Cpu } from "lucide-react";

interface AIProviderSectionProps {
  aiProvider: AIProviderConfig;
  onSave: (config: AIProviderConfig) => Promise<void>;
}

const MODELS: Record<AIProviderConfig["provider"], string[]> = {
  OpenAI: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo"],
  Claude: ["claude-3-5-sonnet-20241022", "claude-3-haiku-20240307", "claude-3-opus-20240229"],
};

export const AIProviderSection: React.FC<AIProviderSectionProps> = ({
  aiProvider,
  onSave,
}) => {
  const [config, setConfig] = useState<AIProviderConfig>({ ...aiProvider });
  const [isSaving, setIsSaving] = useState(false);

  const handleProviderChange = (provider: AIProviderConfig["provider"]) => {
    setConfig((c) => ({
      ...c,
      provider,
      model: MODELS[provider][0],
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(config);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h2 className="text-lg font-bold text-text-primary">AI Provider Configuration</h2>
        <p className="text-xs text-text-secondary mt-1">
          Configure the LLM used for explainable AI root-cause analysis and suggested code diffs.
        </p>
      </div>

      {/* Provider Architecture explanation */}
      <div className="bg-primary/10 border border-primary/30 rounded-card p-4 space-y-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-primary">
          <Sparkles className="w-4 h-4" /> BugZero Explainable AI Pipeline
        </div>
        <div className="text-xs text-text-secondary space-y-1 leading-relaxed">
          <div className="flex items-start gap-2">
            <ShieldCheck className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
            <span><strong className="text-text-primary">Step 1:</strong> Pylint + Bandit static analysis always runs first — evidence-first approach.</span>
          </div>
          <div className="flex items-start gap-2">
            <Cpu className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
            <span><strong className="text-text-primary">Step 2:</strong> CodeBERT ML model classifies findings and assigns confidence scores (0-100%).</span>
          </div>
          <div className="flex items-start gap-2">
            <Sparkles className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
            <span><strong className="text-text-primary">Step 3:</strong> The selected LLM below generates root-cause explanations and code patch diffs.</span>
          </div>
        </div>
      </div>

      {/* Provider toggle */}
      <div>
        <label className="block text-xs font-semibold text-text-secondary uppercase mb-2">
          LLM Provider
        </label>
        <div className="grid grid-cols-2 gap-3">
          {(["OpenAI", "Claude"] as const).map((provider) => (
            <button
              key={provider}
              type="button"
              onClick={() => handleProviderChange(provider)}
              className={`p-4 rounded-card border text-left transition-all ${
                config.provider === provider
                  ? "border-primary bg-primary/10 text-text-primary"
                  : "border-border bg-surface text-text-secondary hover:border-border-strong"
              }`}
            >
              <span className="text-sm font-bold block">{provider}</span>
              <span className="text-[11px] text-text-muted">
                {provider === "OpenAI" ? "GPT-4o, GPT-4 Turbo" : "Claude 3.5, 3 Opus"}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Model select */}
      <div>
        <label className="block text-xs font-semibold text-text-secondary uppercase mb-1.5">
          Model
        </label>
        <select
          value={config.model}
          onChange={(e) => setConfig((c) => ({ ...c, model: e.target.value }))}
          className="w-full h-[48px] bg-surface border border-border rounded-input px-4 text-text-primary focus:outline-none focus:border-primary text-sm transition-colors"
        >
          {MODELS[config.provider].map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
      </div>

      {/* Explanation level */}
      <div>
        <label className="block text-xs font-semibold text-text-secondary uppercase mb-1.5">
          Explanation Depth
        </label>
        <div className="grid grid-cols-3 gap-3">
          {(["Basic", "Detailed", "Deep"] as const).map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => setConfig((c) => ({ ...c, explanationLevel: level }))}
              className={`p-3 rounded-card border text-center transition-all text-xs font-medium ${
                config.explanationLevel === level
                  ? "border-primary bg-primary/10 text-text-primary font-bold"
                  : "border-border bg-surface text-text-secondary hover:border-border-strong"
              }`}
            >
              <span className="block font-bold">{level}</span>
              <span className="text-[10px] text-text-muted">
                {level === "Basic" && "Quick triage"}
                {level === "Detailed" && "Recommended"}
                {level === "Deep" && "Research-level"}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          variant="primary"
          isLoading={isSaving}
          onClick={handleSave}
          leftIcon={<Save className="w-4 h-4" />}
        >
          Save AI Configuration
        </Button>
      </div>
    </div>
  );
};
