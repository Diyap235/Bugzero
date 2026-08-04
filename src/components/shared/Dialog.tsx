"use client";

import React, { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: string;
}

export const Dialog: React.FC<DialogProps> = ({
  isOpen,
  onClose,
  title,
  description,
  children,
  footer,
  maxWidth = "max-w-lg",
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150"
        onClick={onClose}
      />

      {/* Dialog Window */}
      <div
        className={cn(
          "relative w-full bg-card border border-border rounded-dialog p-6 shadow-2xl z-10 animate-in zoom-in-95 duration-150 space-y-5",
          maxWidth
        )}
      >
        <div className="flex items-start justify-between">
          <div className="space-y-1 pr-6">
            <h3 className="text-xl font-semibold text-text-primary tracking-tight">{title}</h3>
            {description && <p className="text-sm text-text-secondary">{description}</p>}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="py-2">{children}</div>

        {footer && <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">{footer}</div>}
      </div>
    </div>
  );
};
