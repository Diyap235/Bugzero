"use client";

import React from "react";
import { cn } from "@/lib/utils";

interface DiffViewerProps {
  original: string;
  modified: string;
  className?: string;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({ original, modified, className }) => {
  const origLines = original.trim().split("\n");
  const modLines = modified.trim().split("\n");

  return (
    <div className={cn("bg-[#050705] border border-border rounded-lg overflow-hidden font-mono text-xs", className)}>
      <div className="bg-card px-4 py-2 border-b border-border text-xs font-sans text-text-secondary flex justify-between">
        <span className="text-danger flex items-center gap-1">- Original Code</span>
        <span className="text-success flex items-center gap-1">+ Suggested Patch</span>
      </div>

      <div className="p-3 space-y-1 overflow-x-auto">
        {origLines.map((line, idx) => (
          <div key={`orig-${idx}`} className="diff-remove px-3 py-1 rounded font-mono text-[12px] whitespace-pre">
            {line}
          </div>
        ))}
        {modLines.map((line, idx) => (
          <div key={`mod-${idx}`} className="diff-add px-3 py-1 rounded font-mono text-[12px] whitespace-pre">
            {line}
          </div>
        ))}
      </div>
    </div>
  );
};
