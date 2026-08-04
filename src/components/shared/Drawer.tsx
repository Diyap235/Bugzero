"use client";

import React, { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface DrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  width?: string;
}

export const Drawer: React.FC<DrawerProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  children,
  footer,
  className,
  width = "w-full md:w-[420px] lg:w-[480px]",
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
    <div className="relative z-50">
      {/* Backdrop overlay for tablet/mobile */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Drawer content panel */}
      <div
        className={cn(
          "fixed inset-y-0 right-0 z-50 bg-surface border-l border-border shadow-2xl flex flex-col transform transition-transform duration-200 ease-out animate-in slide-in-from-right",
          width,
          className
        )}
      >
        {/* Drawer Header */}
        <div className="flex items-start justify-between p-6 border-b border-border bg-card/50">
          <div className="space-y-1 pr-4">
            {typeof title === "string" ? (
              <h2 className="text-lg font-semibold text-text-primary tracking-tight">{title}</h2>
            ) : (
              title
            )}
            {subtitle && <p className="text-xs text-text-secondary">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
            title="Close drawer (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Drawer Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">{children}</div>

        {/* Drawer Footer */}
        {footer && (
          <div className="p-6 border-t border-border bg-card/50 flex items-center justify-end gap-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
