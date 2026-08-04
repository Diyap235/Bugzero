"use client";

import React, { useEffect } from "react";
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ToastMessage {
  id: string;
  type: "success" | "warning" | "danger" | "info";
  message: string;
}

interface ToastProps {
  toast: ToastMessage | null;
  onClose: () => void;
}

export const Toast: React.FC<ToastProps> = ({ toast, onClose }) => {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => {
      onClose();
    }, 4000);
    return () => clearTimeout(timer);
  }, [toast, onClose]);

  if (!toast) return null;

  const icons = {
    success: <CheckCircle2 className="w-5 h-5 text-success" />,
    warning: <AlertTriangle className="w-5 h-5 text-warning" />,
    danger: <AlertCircle className="w-5 h-5 text-danger" />,
    info: <Info className="w-5 h-5 text-info" />,
  };

  const borders = {
    success: "border-success/30 bg-card",
    warning: "border-warning/30 bg-card",
    danger: "border-danger/30 bg-card",
    info: "border-info/30 bg-card",
  };

  return (
    <div className="fixed top-6 right-6 z-50 animate-in slide-in-from-top-4 duration-200">
      <div
        className={cn(
          "flex items-center gap-3 px-4 py-3 border rounded-card shadow-xl max-w-sm text-sm text-text-primary",
          borders[toast.type]
        )}
      >
        {icons[toast.type]}
        <span className="font-medium flex-1">{toast.message}</span>
        <button onClick={onClose} className="text-text-muted hover:text-text-primary p-1">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
