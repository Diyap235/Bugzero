"use client";

import React from "react";
import { ArrowRight, Play, CheckCircle } from "lucide-react";
import { Card } from "../shared/Card";
import { Button } from "../shared/Button";
import { Review } from "@/types";

interface ContinueReviewCardProps {
  review?: Review;
  onContinue: () => void;
}

export const ContinueReviewCard: React.FC<ContinueReviewCardProps> = ({ review, onContinue }) => {
  return (
    <Card className="bg-gradient-to-r from-card to-surface border-primary/40 relative overflow-hidden">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-semibold bg-primary/20 text-primary border border-primary/30">
            <CheckCircle className="w-3.5 h-3.5" />
            <span>Active Review Context</span>
          </div>
          <h3 className="text-xl font-bold text-text-primary tracking-tight">
            Continue Latest Code Review
          </h3>
          <p className="text-xs text-text-secondary">
            Review {review?.id || "rev-2026-0803"} completed with {review?.findingsCount || 4} open findings awaiting resolution.
          </p>
        </div>

        <Button onClick={onContinue} variant="primary" rightIcon={<ArrowRight className="w-4 h-4" />}>
          Continue Review
        </Button>
      </div>
    </Card>
  );
};
