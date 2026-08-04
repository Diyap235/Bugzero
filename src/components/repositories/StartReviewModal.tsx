"use client";

import React, { useState } from "react";
import { Upload, Sparkles, CheckCircle2, Cpu, ShieldCheck } from "lucide-react";
import { Dialog } from "../shared/Dialog";
import { Button } from "../shared/Button";

interface StartReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
  repoName: string;
}

export const StartReviewModal: React.FC<StartReviewModalProps> = ({
  isOpen,
  onClose,
  onComplete,
  repoName,
}) => {
  const [step, setStep] = useState<"idle" | "analyzing" | "completed">("idle");
  const [progressText, setProgressText] = useState("");
  const [currentStageIndex, setCurrentStageIndex] = useState(0);

  const stages = [
    { label: "Parsing repository structure & normalization", icon: Cpu },
    { label: "Running Static Analysis (Pylint & Bandit)", icon: ShieldCheck },
    { label: "CodeBERT ML classification & severity scoring", icon: Sparkles },
    { label: "LLM Explainable AI generating root cause fixes", icon: CheckCircle2 },
  ];

  const handleStart = async () => {
    setStep("analyzing");
    for (let i = 0; i < stages.length; i++) {
      setCurrentStageIndex(i);
      setProgressText(stages[i].label);
      await new Promise((res) => setTimeout(res, 700));
    }
    setStep("completed");
  };

  const handleFinish = () => {
    setStep("idle");
    onComplete();
    onClose();
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={step === "analyzing" ? () => {} : onClose}
      title={`Start Review: ${repoName}`}
      description="Run full-spectrum static analysis (Pylint + Bandit) and CodeBERT ML classification."
    >
      {step === "idle" && (
        <div className="space-y-6">
          {/* File Upload Zone */}
          <div className="border-2 border-dashed border-border hover:border-primary rounded-card p-8 text-center space-y-3 bg-surface cursor-pointer transition-colors">
            <Upload className="w-10 h-10 text-primary mx-auto" />
            <div className="space-y-1">
              <p className="text-sm font-semibold text-text-primary">
                Upload Python source files or ZIP archive
              </p>
              <p className="text-xs text-text-muted">
                Drag & drop `.py` files or click to browse (Max 50MB)
              </p>
            </div>
          </div>

          {/* Options */}
          <div className="space-y-3 bg-surface p-4 border border-border rounded-lg text-xs">
            <div className="flex items-center justify-between">
              <span className="text-text-secondary font-medium">Static Analyzers</span>
              <span className="text-primary font-mono font-semibold">Pylint + Bandit</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-secondary font-medium">ML Model Classifier</span>
              <span className="text-primary font-mono font-semibold">CodeBERT Base</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-secondary font-medium">Explainable AI Provider</span>
              <span className="text-primary font-mono font-semibold">OpenAI / Claude</span>
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleStart} leftIcon={<Sparkles className="w-4 h-4" />}>
              Run AI Review
            </Button>
          </div>
        </div>
      )}

      {step === "analyzing" && (
        <div className="py-8 text-center space-y-6">
          <div className="relative w-16 h-16 mx-auto flex items-center justify-center">
            <div className="absolute inset-0 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
            <Sparkles className="w-6 h-6 text-primary animate-pulse" />
          </div>

          <div className="space-y-2">
            <h4 className="text-base font-semibold text-text-primary">Analyzing Codebase...</h4>
            <p className="text-xs text-text-secondary font-mono animate-pulse">{progressText}</p>
          </div>

          {/* Stepper Progress */}
          <div className="space-y-2 text-left max-w-sm mx-auto pt-4">
            {stages.map((stg, idx) => {
              const isDone = idx < currentStageIndex;
              const isCurrent = idx === currentStageIndex;
              return (
                <div key={idx} className="flex items-center gap-3 text-xs">
                  <div
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                      isDone
                        ? "bg-success text-white"
                        : isCurrent
                        ? "bg-primary text-white animate-bounce"
                        : "bg-surface text-text-muted border border-border"
                    }`}
                  >
                    {isDone ? "✓" : idx + 1}
                  </div>
                  <span className={isCurrent ? "text-text-primary font-semibold" : "text-text-muted"}>
                    {stg.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {step === "completed" && (
        <div className="py-6 text-center space-y-5">
          <div className="w-14 h-14 bg-success/20 border border-success/40 rounded-full text-success flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-8 h-8" />
          </div>

          <div className="space-y-1">
            <h4 className="text-lg font-bold text-text-primary">Repository Review Completed!</h4>
            <p className="text-xs text-text-secondary">
              Analyzed 42 files in 1.4s. Generated 4 findings with evidence & code diffs.
            </p>
          </div>

          <Button variant="primary" className="w-full" onClick={handleFinish}>
            View Review Findings
          </Button>
        </div>
      )}
    </Dialog>
  );
};
