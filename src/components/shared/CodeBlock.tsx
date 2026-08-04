"use client";

import React, { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

interface CodeBlockProps {
  code: string;
  language?: string;
  filename?: string;
  className?: string;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({
  code,
  language = "python",
  filename,
  className,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lines = code.trim().split("\n");

  return (
    <div className={cn("bg-[#050705] border border-border rounded-lg overflow-hidden font-mono text-xs", className)}>
      {/* Code Header */}
      <div className="bg-card px-4 py-2 border-b border-border flex items-center justify-between text-text-muted">
        <span className="text-xs font-sans text-text-secondary">{filename || language}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 hover:text-text-primary text-text-muted transition-colors text-xs"
          title="Copy code"
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-success" />
              <span className="text-success text-xs font-sans">Copied!</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span className="font-sans">Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Code Lines */}
      <div className="p-4 overflow-x-auto">
        <table className="w-full border-collapse">
          <tbody>
            {lines.map((line, idx) => (
              <tr key={idx} className="hover:bg-surface-hover/50">
                <td className="w-8 pr-4 text-right text-text-muted select-none font-mono text-[11px] opacity-50">
                  {idx + 1}
                </td>
                <td className="text-text-primary font-mono whitespace-pre leading-relaxed">{line}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
