"use client";

import React, { useState } from "react";
import { Upload, Sparkles, CheckCircle2, Shield, Search } from "lucide-react";
import { Dialog } from "../shared/Dialog";
import { Button } from "../shared/Button";

interface StartReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
  repoName: string;
}

// Stage labels — no internal tool names
const STAGES = [
  { label: "Parsing repository structure",           icon: Search    },
  { label: "Running static security analysis",       icon: Shield    },
  { label: "Classifying findings and scoring risk",  icon: Sparkles  },
  { label: "Generating root-cause explanations",     icon: CheckCircle2 },
];

export const StartReviewModal: React.FC<StartReviewModalProps> = ({
  isOpen,
  onClose,
  onComplete,
  repoName,
}) => {
  const [step, setStep]                       = useState<"idle" | "analyzing" | "completed">("idle");
  const [currentStage, setCurrentStage]       = useState(0);
  const [progressText, setProgressText]       = useState("");

  const handleStart = async () => {
    setStep("analyzing");
    for (let i = 0; i < STAGES.length; i++) {
      setCurrentStage(i);
      setProgressText(STAGES[i].label);
      await new Promise((res) => setTimeout(res, 700));
    }
    setStep("completed");
  };

  const handleFinish = () => {
    setStep("idle");
    setCurrentStage(0);
    onComplete();
    onClose();
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={step === "analyzing" ? () => {} : onClose}
      title={`New Review — ${repoName}`}
      description="Upload your source files to run a full security and quality analysis."
    >
      {step === "idle" && (
        <div className="space-y-5">
          {/* Upload zone */}
          <div className="border-2 border-dashed border-border hover:border-primary rounded-card p-8 text-center space-y-3 bg-surface cursor-pointer transition-colors">
            <Upload className="w-9 h-9 text-primary mx-auto" />
            <div>
              <p className="text-sm font-semibold text-text-primary">
                Upload source files or ZIP archive
              </p>
              <p className="text-xs text-text-muted mt-1">
                Drag & drop files here or click to browse (max 50 MB)
              </p>
            </div>
          </div>

          {/* What the review includes */}
          <div className="bg-surface border border-border rounded-xl divide-y divide-border text-xs">
            {[
              "Security vulnerability detection",
              "Code quality and complexity analysis",
              "Prioritised findings with confidence scores",
              "Suggested fixes with code diffs",
            ].map((item) => (
              <div key={item} className="flex items-center gap-2.5 px-4 py-3 text-text-secondary">
                <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" />
                {item}
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={handleStart} leftIcon={<Sparkles className="w-4 h-4" />}>
              Run Review
            </Button>
          </div>
        </div>
      )}

      {step === "analyzing" && (
        <div className="py-8 text-center space-y-6">
          {/* Spinner */}
          <div className="relative w-14 h-14 mx-auto flex items-center justify-center">
            <div className="absolute inset-0 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
            <Sparkles className="w-5 h-5 text-primary animate-pulse" />
          </div>

          <div>
            <h4 className="text-base font-semibold text-text-primary">Analysing…</h4>
            <p className="text-xs text-text-muted font-mono mt-1 animate-pulse">{progressText}</p>
          </div>

          {/* Steps */}
          <div className="space-y-2 text-left max-w-xs mx-auto">
            {STAGES.map((s, idx) => {
              const done    = idx < currentStage;
              const current = idx === currentStage;
              return (
                <div key={idx} className="flex items-center gap-3 text-xs">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                    done    ? "bg-success text-white" :
                    current ? "bg-primary text-white animate-bounce" :
                              "bg-surface text-text-muted border border-border"
                  }`}>
                    {done ? "✓" : idx + 1}
                  </div>
                  <span className={current ? "text-text-primary font-semibold" : "text-text-muted"}>
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {step === "completed" && (
        <div className="py-6 text-center space-y-5">
          <div className="w-14 h-14 bg-success/15 border border-success/30 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-8 h-8 text-success" />
          </div>
          <div>
            <h4 className="text-lg font-bold text-text-primary">Review Complete</h4>
            <p className="text-xs text-text-secondary mt-1">
              Findings are ready to review with suggested fixes.
            </p>
          </div>
          <Button variant="primary" className="w-full" onClick={handleFinish}>
            View Findings
          </Button>
        </div>
      )}
    </Dialog>
  );
};
