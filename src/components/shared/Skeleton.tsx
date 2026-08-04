import React from "react";
import { cn } from "@/lib/utils";

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {}

export const Skeleton: React.FC<SkeletonProps> = ({ className, ...props }) => {
  return (
    <div
      className={cn("animate-pulse bg-surface-hover/80 rounded-md", className)}
      {...props}
    />
  );
};

export const RepositoryCardSkeleton: React.FC = () => (
  <div className="bg-card border border-border rounded-card p-6 space-y-4">
    <div className="flex items-center justify-between">
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-5 w-16 rounded-full" />
    </div>
    <Skeleton className="h-4 w-full" />
    <Skeleton className="h-4 w-3/4" />
    <div className="pt-4 border-t border-border flex items-center justify-between">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-9 w-28 rounded-button" />
    </div>
  </div>
);

export const TableRowSkeleton: React.FC = () => (
  <div className="flex items-center space-x-4 p-4 border-b border-border">
    <Skeleton className="h-5 w-20 rounded-full" />
    <Skeleton className="h-5 flex-1" />
    <Skeleton className="h-5 w-32" />
    <Skeleton className="h-5 w-16" />
  </div>
);
