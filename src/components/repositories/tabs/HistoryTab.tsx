"use client";

import React from "react";
import Link from "next/link";
import { Review } from "@/types";
import { EmptyState } from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/shared/Skeleton";
import { CheckCircle2, Clock, AlertCircle, Play, Loader2, FileText, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface HistoryTabProps {
  reviews: Review[];
  isLoading: boolean;
  onStartReview: () => void;
}

const STATUS_ICON: Record<Review["status"], React.ReactNode> = {
  completed: <CheckCircle2 className="w-4 h-4 text-success" />,
  failed:    <AlertCircle  className="w-4 h-4 text-danger"  />,
  analyzing: <Loader2      className="w-4 h-4 text-warning animate-spin" />,
  pending:   <Clock        className="w-4 h-4 text-text-muted" />,
};

const STATUS_COLOR: Record<Review["status"], string> = {
  completed: "text-success",
  failed:    "text-danger",
  analyzing: "text-warning",
  pending:   "text-text-muted",
};

export const HistoryTab: React.FC<HistoryTabProps> = ({ reviews, isLoading, onStartReview }) => {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-2xl" />)}
      </div>
    );
  }

  if (reviews.length === 0) {
    return (
      <EmptyState
        icon={<Play className="w-12 h-12 text-text-muted" />}
        title="No review history"
        description="Run your first review to start tracking repository quality over time."
        actionLabel="Run Review"
        onAction={onStartReview}
      />
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-[#7E8A84] pb-1">
        {reviews.length} review{reviews.length !== 1 ? "s" : ""} •{" "}
        <span className="text-[#AAB5AF] font-semibold">Latest: {reviews[0].createdAt}</span>
      </p>

      {reviews.map((review, idx) => {
        const hColor =
          review.healthScore >= 80 ? "text-success" :
          review.healthScore >= 60 ? "text-warning"  : "text-danger";

        return (
          <motion.div
            key={review.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.05, duration: 0.3 }}
            className="bg-[#101915] border border-[#1E3025] rounded-2xl p-5 hover:border-[#294134] transition-colors"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              {/* Left */}
              <div className="flex items-start gap-3">
                <div className="mt-0.5 shrink-0">{STATUS_ICON[review.status]}</div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-semibold font-mono text-white">{review.id}</span>
                    {idx === 0 && (
                      <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-[#2E7D32]/20 text-[#4CAF50] border border-[#2E7D32]/30">
                        LATEST
                      </span>
                    )}
                    <span className={cn("text-[12px] font-semibold capitalize", STATUS_COLOR[review.status])}>
                      {review.status}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-[#7E8A84] mt-1">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" /> {review.createdAt}
                    </span>
                    <span>Duration: <span className="text-[#AAB5AF] font-mono">{review.duration}</span></span>
                    <span className="text-[#AAB5AF]">{review.reviewer}</span>
                  </div>
                </div>
              </div>

              {/* Right */}
              <div className="flex items-center gap-4 shrink-0">
                <div className="text-right">
                  <span className={cn("text-xl font-bold font-mono", hColor)}>{review.healthScore}%</span>
                  <span className="text-[10px] text-[#7E8A84] block">Health</span>
                </div>
                <div className="text-right">
                  <span className="text-xl font-bold font-mono text-white">{review.findingsCount}</span>
                  <span className="text-[10px] text-[#7E8A84] block">Findings</span>
                </div>
                {/* View Report instead of Compare */}
                <Link href="/reports">
                  <motion.button
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                    className="flex items-center gap-1.5 h-9 px-3.5 border border-[#1E3025] hover:border-[#294134] hover:bg-[#16211B] text-[#AAB5AF] hover:text-white text-[12px] font-medium rounded-xl transition-all"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    View Report
                    <ArrowRight className="w-3 h-3" />
                  </motion.button>
                </Link>
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
};
