"use client";

import React from "react";
import Link from "next/link";
import { GitBranch, ShieldAlert, ArrowRight } from "lucide-react";
import { Repository } from "@/types";
import { Card } from "../shared/Card";
import { Button } from "../shared/Button";

interface RepositoryCardProps {
  repository: Repository;
}

export const RepositoryCard: React.FC<RepositoryCardProps> = ({ repository }) => {
  return (
    <Card hoverable className="flex flex-col justify-between min-h-[180px] space-y-4">
      {/* Header */}
      <div>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-primary" />
            <h3 className="text-base font-semibold text-text-primary hover:text-primary transition-colors">
              {repository.name}
            </h3>
          </div>
          <span className="px-2.5 py-0.5 rounded-full text-xs font-mono bg-surface border border-border text-text-secondary">
            {repository.primaryLanguage}
          </span>
        </div>
        <p className="text-xs text-text-secondary mt-2 line-clamp-2 leading-relaxed">
          {repository.description}
        </p>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 gap-4 py-3 border-y border-border/60 text-xs">
        <div>
          <span className="text-text-muted block text-[11px]">Health Score</span>
          <span
            className={`font-mono font-bold text-base ${
              repository.healthScore >= 80
                ? "text-success"
                : repository.healthScore >= 60
                ? "text-warning"
                : "text-danger"
            }`}
          >
            {repository.healthScore}/100
          </span>
        </div>
        <div>
          <span className="text-text-muted block text-[11px]">Open Findings</span>
          <div className="flex items-center gap-1.5 font-semibold text-text-primary">
            <span>{repository.openFindingsCount} total</span>
            {repository.criticalFindingsCount > 0 && (
              <span className="text-danger flex items-center text-[11px] gap-0.5">
                (<ShieldAlert className="w-3 h-3" /> {repository.criticalFindingsCount} critical)
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-text-muted">
        <span>Reviewed {repository.updatedAt}</span>
        <Link href={`/repositories/${repository.id}`}>
          <Button size="sm" variant="secondary" rightIcon={<ArrowRight className="w-3.5 h-3.5" />}>
            Open Repo
          </Button>
        </Link>
      </div>
    </Card>
  );
};
