"use client";

import React, { useState } from "react";
import { Finding, FindingStatus } from "@/types";
import { Drawer } from "../shared/Drawer";
import { Button } from "../shared/Button";
import { SeverityBadge } from "../shared/SeverityBadge";
import { ConfidenceBadge } from "../shared/ConfidenceBadge";
import { CodeBlock } from "../shared/CodeBlock";
import { DiffViewer } from "../shared/DiffViewer";
import { Check, Copy, ExternalLink, ShieldCheck, Sparkles } from "lucide-react";

interface FindingDrawerProps {
  finding: Finding | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdateStatus: (id: string, status: FindingStatus) => Promise<void>;
}

export const FindingDrawer: React.FC<FindingDrawerProps> = ({
  finding,
  isOpen,
  onClose,
  onUpdateStatus,
}) => {
  const [isUpdating, setIsUpdating] = useState(false);
  const [copiedExplanation, setCopiedExplanation] = useState(false);

  if (!finding) return null;

  const handleResolve = async () => {
    setIsUpdating(true);
    try {
      await onUpdateStatus(finding.id, "resolved");
    } finally {
      setIsUpdating(false);
    }
  };

  const handleCopyExplanation = () => {
    const text = `Title: ${finding.title}\nFile: ${finding.file}:${finding.line}\n\nProblem:\n${finding.aiExplanation.problem}\n\nWhy it matters:\n${finding.aiExplanation.whyItMatters}\n\nBest Practice:\n${finding.aiExplanation.bestPractice}`;
    navigator.clipboard.writeText(text);
    setCopiedExplanation(true);
    setTimeout(() => setCopiedExplanation(false), 2000);
  };

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2">
          <SeverityBadge severity={finding.severity} />
          <ConfidenceBadge confidence={finding.confidence} />
        </div>
      }
      subtitle={`${finding.file}:${finding.line}`}
      footer={
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopyExplanation}
            leftIcon={copiedExplanation ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
          >
            {copiedExplanation ? "Copied" : "Copy AI Explanation"}
          </Button>
          {finding.status !== "resolved" ? (
            <Button
              variant="primary"
              size="sm"
              isLoading={isUpdating}
              onClick={handleResolve}
              leftIcon={<Check className="w-4 h-4" />}
            >
              Resolve Finding
            </Button>
          ) : (
            <span className="text-xs font-semibold text-success flex items-center gap-1">
              <Check className="w-4 h-4" /> Resolved
            </span>
          )}
        </>
      }
    >
      {/* 1. Summary */}
      <div className="space-y-2 border-b border-border pb-4">
        <h3 className="text-lg font-bold text-text-primary leading-snug">{finding.title}</h3>
        <p className="text-xs text-text-secondary leading-relaxed">{finding.summary}</p>
      </div>

      {/* 2. Evidence (MUST appear before AI explanation per Bible rule) */}
      <div className="space-y-3 border-b border-border pb-6">
        <div className="flex items-center justify-between text-xs font-semibold text-text-muted uppercase tracking-wider">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-primary" /> Static Analysis Evidence
          </span>
          <span className="px-2 py-0.5 bg-card border border-border rounded text-[10px] font-mono text-primary">
            Source: {finding.evidence.staticAnalysisSource}
          </span>
        </div>
        <div className="text-xs text-text-secondary font-mono">
          File: <span className="text-text-primary font-semibold">{finding.file}</span> ({finding.evidence.lineNumbers})
        </div>
        <CodeBlock code={finding.evidence.codeSnippet} filename={finding.file} />
      </div>

      {/* 3. AI Explanation */}
      <div className="space-y-4 border-b border-border pb-6">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-primary uppercase tracking-wider">
          <Sparkles className="w-4 h-4 text-primary animate-pulse" /> CodeBERT + LLM XAI Analysis
        </div>

        <div className="bg-card p-4 border border-border rounded-lg space-y-3 text-xs">
          <div>
            <span className="text-text-muted font-semibold block mb-0.5">Problem Root Cause:</span>
            <p className="text-text-primary leading-relaxed">{finding.aiExplanation.problem}</p>
          </div>

          <div>
            <span className="text-text-muted font-semibold block mb-0.5">Why It Matters:</span>
            <p className="text-text-secondary leading-relaxed">{finding.aiExplanation.whyItMatters}</p>
          </div>

          <div>
            <span className="text-text-muted font-semibold block mb-0.5">Engineering Best Practice:</span>
            <p className="text-text-secondary leading-relaxed">{finding.aiExplanation.bestPractice}</p>
          </div>
        </div>
      </div>

      {/* 4. Suggested Fix & Code Diff */}
      <div className="space-y-3 border-b border-border pb-6">
        <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider">Suggested Fix & Patch Diff</h4>
        <p className="text-xs text-text-secondary">{finding.suggestedFix.explanation}</p>
        <DiffViewer original={finding.diff.original} modified={finding.diff.modified} />
      </div>

      {/* 5. References */}
      {finding.references.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wider">Security & Quality References</h4>
          <ul className="space-y-1 text-xs">
            {finding.references.map((refUrl, idx) => (
              <li key={idx}>
                <a
                  href={refUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline font-mono inline-flex items-center gap-1 truncate max-w-full"
                >
                  <ExternalLink className="w-3 h-3 shrink-0" />
                  <span className="truncate">{refUrl}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Drawer>
  );
};
