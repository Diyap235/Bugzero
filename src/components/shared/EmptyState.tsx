import React from "react";
import { FolderOpen } from "lucide-react";
import { Button } from "./Button";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon = <FolderOpen className="w-12 h-12 text-text-muted" />,
  title,
  description,
  actionLabel,
  onAction,
  className,
}) => {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center p-12 text-center bg-card/50 border border-dashed border-border rounded-card space-y-4 max-w-md mx-auto my-8",
        className
      )}
    >
      <div className="p-4 bg-surface border border-border rounded-full text-text-muted">{icon}</div>
      <div className="space-y-1">
        <h3 className="text-lg font-semibold text-text-primary tracking-tight">{title}</h3>
        <p className="text-sm text-text-secondary leading-relaxed">{description}</p>
      </div>
      {actionLabel && onAction && (
        <Button onClick={onAction} variant="primary" className="mt-2">
          {actionLabel}
        </Button>
      )}
    </div>
  );
};
