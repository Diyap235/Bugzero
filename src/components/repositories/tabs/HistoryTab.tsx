"use client";

import React, { useState } from "react";
import { Review } from "@/types";
import { CompareDialog } from "@/components/history/CompareDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/shared/Button";
import { Skeleton } from "@/components/shared/Skeleton";
import { Card } from "@/components/shared/Card";
import {
  CheckCircle2,
  Clock,
  AlertCircle,
  Play,
  GitCompareArrows,
  Loader2,
  Sparkles,
} from "lucide-react";

interface HistoryTabProps {
  reviews: Review[];
  isLoading: boolean;
  onStartReview: () => void;
}

const statusIcon = {
  completed: <CheckCircle2 className="w-4 h-4 text-success" />,
  failed: <AlertCircle className="w-4 h-4 text-danger" />,
  analyzing: <Loader2 className="w-4 h-4 text-warning animate-spin" />,
  pending: <Clock className="w-4 h-4 text-text-muted" />,
};

const statusLabel = {
  completed: "text-success",
  failed: "text-danger",
  analyzing: "text-warning",
  pending: "text-text-muted",
};

export const HistoryTab: React.FC<HistoryTabProps> = ({ reviews, isLoading, onStartReview }) => {
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareTarget, setCompareTarget] = useState<Review | null>(null);

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 rounded-card" />
        ))}
      </div>
    );
  }

  if (reviews.length === 0) {
    return (
      <EmptyState
        icon={<Play className="w-12 h-12 text-text-muted" />}
        title="No review history"
        description="Run your first AI review to start tracking repository quality over time."
        actionLabel="Run AI Review"
        onAction={onStartReview}
      />
    );
  }

  const latestReview = reviews[0];

  const handleCompare = (review: Review) => {
    setCompareTarget(review);
    setCompareOpen(true);
  };

  return (
    <div className="space-y-4">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-muted">
          {reviews.length} review{reviews.length > 1 ? "s" : ""} in history •{" "}
          <span className="text-text-secondary font-semibold">
            Latest: {latestReview.createdAt}
          </span>
        </p>
        {reviews.length >= 2 && (
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<GitCompareArrows className="w-4 h-4" />}
            onClick={() => handleCompare(reviews[1])}
          >
            Compare Latest vs Baseline
          </Button>
        )}
      </div>

      {/* Review history list */}
      <div className="space-y-3">
        {reviews.map((review, idx) => (
          <Card
            key={review.id}
            className="hover:border-border-strong transition-colors"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              {/* Left: Review ID, status, metadata */}
              <div className="flex items-start gap-3">
                <div className="mt-0.5">{statusIcon[review.status]}</div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold font-mono text-text-primary">
                      {review.id}
                    </span>
                    {idx === 0 && (
                      <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-primary/20 text-primary border border-primary/30">
                        LATEST
                      </span>
                    )}
                    <span className={`text-xs font-semibold capitalize ${statusLabel[review.status]}`}>
                      {review.status}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-text-muted">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" /> {review.createdAt}
                    </span>
                    <span>Duration: <span className="text-text-secondary font-mono">{review.duration}</span></span>
                    <span className="flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-primary" />
                      {review.reviewer}
                    </span>
                  </div>
                </div>
              </div>

              {/* Right: Health score + findings + compare button */}
              <div className="flex items-center gap-4 shrink-0">
                <div className="text-right">
                  <span
                    className={`text-xl font-bold font-mono ${
                      review.healthScore >= 80
                        ? "text-success"
                        : review.healthScore >= 60
                        ? "text-warning"
                        : "text-danger"
                    }`}
                  >
                    {review.healthScore}%
                  </span>
                  <span className="text-[11px] text-text-muted block">Health</span>
                </div>
                <div className="text-right">
                  <span className="text-xl font-bold font-mono text-text-primary">
                    {review.findingsCount}
                  </span>
                  <span className="text-[11px] text-text-muted block">Findings</span>
                </div>
                {idx > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    leftIcon={<GitCompareArrows className="w-3.5 h-3.5" />}
                    onClick={() => handleCompare(review)}
                    title="Compare this review vs latest"
                  >
                    Compare
                  </Button>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Compare Dialog */}
      {compareTarget && (
        <CompareDialog
          isOpen={compareOpen}
          onClose={() => setCompareOpen(false)}
          reviewA={latestReview}
          reviewB={compareTarget}
        />
      )}
    </div>
  );
};
