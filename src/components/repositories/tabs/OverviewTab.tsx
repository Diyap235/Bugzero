"use client";

import React, { useRef, useEffect, useState } from "react";
import Link from "next/link";
import { Repository, Review, Finding } from "@/types";
import { Timeline } from "@/components/repositories/Timeline";
import { Skeleton } from "@/components/shared/Skeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import {
  GitBranch, Play, ShieldAlert, ChevronRight, Sparkles,
  FileCode2, Clock, TrendingUp, CheckCircle2, AlertTriangle,
} from "lucide-react";
import { motion, useInView } from "framer-motion";
import { cn } from "@/lib/utils";

function AnimatedNumber({ to }: { to: number }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true });
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!inView) return;
    let n = 0;
    const step = Math.max(1, Math.floor(to / 30));
    const t = setInterval(() => {
      n = Math.min(n + step, to);
      setVal(n);
      if (n >= to) clearInterval(t);
    }, 28);
    return () => clearInterval(t);
  }, [inView, to]);
  return <span ref={ref}>{val}</span>;
}

interface OverviewTabProps {
  repository: Repository | null;
  latestReview: Review | undefined;
  findings: Finding[];
  isLoading: boolean;
  onStartReview: () => void;
  onViewFinding: () => void;
}

export const OverviewTab: React.FC<OverviewTabProps> = ({
  repository, latestReview, findings, isLoading, onStartReview, onViewFinding,
}) => {
  if (isLoading) {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-24 rounded-2xl" />)}
        </div>
        <Skeleton className="h-56 rounded-2xl" />
        <Skeleton className="h-40 rounded-2xl" />
      </div>
    );
  }

  if (!repository) {
    return (
      <EmptyState icon={<GitBranch className="w-12 h-12 text-[#7E8A84]" />} title="Repository not found" description="This repository does not exist or has been removed." />
    );
  }

  if (!latestReview) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center justify-center py-24 text-center space-y-5"
      >
        <div className="w-20 h-20 rounded-3xl bg-[#0B120F] border border-[#1E3025] flex items-center justify-center">
          <Sparkles className="w-9 h-9 text-[#2E7D32]" />
        </div>
        <div>
          <h3 className="text-xl font-bold text-white">Start your first AI review</h3>
          <p className="text-[14px] text-[#AAB5AF] mt-2 max-w-sm">
            Run static analysis, CodeBERT classification, and get actionable code diffs in seconds.
          </p>
        </div>
        <motion.button
          whileHover={{ scale: 1.03, boxShadow: "0 0 24px rgba(46,125,50,0.3)" }}
          whileTap={{ scale: 0.97 }}
          onClick={onStartReview}
          className="flex items-center gap-2.5 h-12 px-8 bg-[#2E7D32] hover:bg-[#388E3C] text-white text-[14px] font-bold rounded-xl transition-all"
        >
          <Play className="w-4 h-4" /> Run AI Review
        </motion.button>
        <div className="flex items-center gap-6 text-[11px] text-[#7E8A84]">
          {["Static Analysis", "ML Classification", "Root-Cause Diffs"].map((t) => (
            <span key={t} className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-[#2E7D32]" />{t}</span>
          ))}
        </div>
      </motion.div>
    );
  }

  const openFindings = findings.filter((f) => f.status === "open");
  const criticalFindings = findings.filter((f) => f.severity === "critical" && f.status === "open");
  const resolvedFindings = findings.filter((f) => f.status === "resolved");
  const healthColor = repository.healthScore >= 80 ? "text-[#4CAF50]" : repository.healthScore >= 60 ? "text-[#F59E0B]" : "text-[#EF4444]";
  const healthBg    = repository.healthScore >= 80 ? "bg-[#4CAF50]" : repository.healthScore >= 60 ? "bg-[#F59E0B]" : "bg-[#EF4444]";

  return (
    <div className="space-y-5">
      {/* ── KPI Bento row ── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="grid grid-cols-2 md:grid-cols-4 gap-4"
      >
        {[
          { label: "Health Score",     value: repository.healthScore, suffix: "/100", color: healthColor,    bg: "border-[#2E7D32]/20 bg-[#2E7D32]/5"   },
          { label: "Open Findings",    value: openFindings.length,    suffix: "",      color: "text-[#F59E0B]",  bg: "border-[#F59E0B]/20 bg-[#F59E0B]/5"   },
          { label: "Critical Issues",  value: criticalFindings.length,suffix: "",      color: criticalFindings.length > 0 ? "text-[#EF4444]" : "text-[#4CAF50]", bg: criticalFindings.length > 0 ? "border-[#EF4444]/20 bg-[#EF4444]/5" : "border-[#4CAF50]/20 bg-[#4CAF50]/5" },
          { label: "Resolved",         value: resolvedFindings.length,suffix: "",      color: "text-[#4CAF50]",  bg: "border-[#4CAF50]/20 bg-[#4CAF50]/5"   },
        ].map((kpi) => (
          <div key={kpi.label} className={cn("p-5 rounded-2xl border", kpi.bg)}>
            <p className="text-[11px] text-[#7E8A84] uppercase tracking-wider mb-2">{kpi.label}</p>
            <p className={cn("text-3xl font-bold font-mono", kpi.color)}>
              <AnimatedNumber to={kpi.value} />{kpi.suffix}
            </p>
          </div>
        ))}
      </motion.div>

      {/* ── Critical alert banner ── */}
      {criticalFindings.length > 0 && (
        <motion.div
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.35, delay: 0.1 }}
          className="flex items-center justify-between gap-4 px-5 py-4 bg-[#EF4444]/8 border border-[#EF4444]/30 rounded-2xl"
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-[#EF4444]/20 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-4 h-4 text-[#EF4444]" />
            </div>
            <div>
              <p className="text-[13px] font-bold text-[#EF4444]">
                {criticalFindings.length} critical finding{criticalFindings.length > 1 ? "s" : ""} require immediate attention
              </p>
              <p className="text-[11px] text-[#AAB5AF]">{criticalFindings[0]?.title}</p>
            </div>
          </div>
          <button
            onClick={onViewFinding}
            className="flex items-center gap-1.5 px-4 py-2 bg-[#EF4444]/20 hover:bg-[#EF4444]/30 border border-[#EF4444]/40 text-[#EF4444] text-[12px] font-bold rounded-xl transition-colors shrink-0"
          >
            Review Now <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </motion.div>
      )}

      {/* ── Main bento grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Left 2/3 — Snapshot + Priority Findings */}
        <div className="lg:col-span-2 space-y-5">

          {/* Repository snapshot */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.08 }}
            className="bg-[#101915] border border-[#1E3025] rounded-2xl p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-semibold text-[#7E8A84] uppercase tracking-wider">Repository Snapshot</h3>
              <span className="text-[11px] text-[#7E8A84] font-mono">{latestReview.createdAt}</span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Branch",       val: repository.branch,         icon: GitBranch,  color: "text-[#2E7D32]"  },
                { label: "Files",        val: `${repository.fileCount}`, icon: FileCode2,  color: "text-[#3B82F6]"  },
                { label: "Last Review",  val: repository.updatedAt,       icon: Clock,      color: "text-[#AAB5AF]"  },
                { label: "Duration",     val: latestReview.duration,     icon: TrendingUp, color: "text-[#4CAF50]"  },
              ].map((m) => {
                const Icon = m.icon;
                return (
                  <div key={m.label} className="bg-[#0B120F] border border-[#1E3025] rounded-xl p-3">
                    <div className="flex items-center gap-1.5 text-[10px] text-[#7E8A84] mb-1.5">
                      <Icon className={cn("w-3 h-3", m.color)} />
                      {m.label}
                    </div>
                    <span className="text-[13px] font-semibold text-white truncate block">{m.val}</span>
                  </div>
                );
              })}
            </div>

            {/* Health bar */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-[11px]">
                <span className="text-[#7E8A84]">Repository Health</span>
                <span className={cn("font-mono font-bold", healthColor)}>{repository.healthScore}%</span>
              </div>
              <div className="h-2 bg-[#0B120F] rounded-full border border-[#1E3025] overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${repository.healthScore}%` }}
                  transition={{ duration: 1, delay: 0.4, ease: [0.22, 1, 0.36, 1] }}
                  className={cn("h-full rounded-full", healthBg)}
                />
              </div>
            </div>
          </motion.div>

          {/* Priority findings */}
          {openFindings.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.15 }}
              className="bg-[#101915] border border-[#1E3025] rounded-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between px-5 py-4 border-b border-[#1E3025]">
                <h3 className="text-[13px] font-semibold text-[#7E8A84] uppercase tracking-wider">
                  Priority Findings
                </h3>
                <button
                  onClick={onViewFinding}
                  className="text-[11px] text-[#2E7D32] hover:text-[#4CAF50] font-semibold transition-colors flex items-center gap-1"
                >
                  View all {openFindings.length} <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="divide-y divide-[#1E3025]">
                {openFindings.slice(0, 4).map((f, i) => (
                  <motion.div
                    key={f.id}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.2 + i * 0.06, duration: 0.3 }}
                    onClick={onViewFinding}
                    className="flex items-center gap-3 px-5 py-3.5 hover:bg-[#16211B] transition-colors cursor-pointer group"
                  >
                    <span className={cn(
                      "shrink-0 px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase",
                      f.severity === "critical" ? "bg-[#EF4444]/15 text-[#EF4444] border border-[#EF4444]/25" :
                      f.severity === "high"     ? "bg-[#F59E0B]/15 text-[#F59E0B] border border-[#F59E0B]/25" :
                      f.severity === "medium"   ? "bg-yellow-500/15 text-yellow-500 border border-yellow-500/25" :
                      "bg-[#3B82F6]/15 text-[#3B82F6] border border-[#3B82F6]/25"
                    )}>
                      {f.severity}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-white truncate group-hover:text-[#4CAF50] transition-colors">{f.title}</p>
                      <p className="text-[11px] text-[#7E8A84] font-mono truncate">{f.file}:{f.line}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] font-mono text-[#7E8A84] bg-[#0B120F] px-2 py-0.5 rounded-lg border border-[#1E3025]">
                        AI {f.confidence}%
                      </span>
                      <ChevronRight className="w-3.5 h-3.5 text-[#7E8A84] group-hover:text-white transition-colors" />
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </div>

        {/* Right 1/3 — AI status + Timeline */}
        <div className="space-y-5">
          {/* AI Engine card */}
          <motion.div
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="bg-[#101915] border border-[#1E3025] rounded-2xl p-5 space-y-4"
          >
            <div className="flex items-center gap-2 text-[12px] font-semibold text-[#2E7D32]">
              <Sparkles className="w-4 h-4 animate-pulse" />
              AI Review Summary
            </div>
            <div className="space-y-2.5 text-[12px]">
              {[
                { label: "Reviewer",  val: latestReview.reviewer,                       color: "text-white"          },
                { label: "Duration",  val: latestReview.duration,                       color: "text-[#4CAF50]"      },
                { label: "Status",    val: latestReview.status,                         color: "text-[#4CAF50]"      },
                { label: "Findings",  val: `${latestReview.findingsCount} detected`,    color: "text-[#F59E0B]"      },
              ].map((r) => (
                <div key={r.label} className="flex items-center justify-between">
                  <span className="text-[#7E8A84]">{r.label}</span>
                  <span className={cn("font-semibold capitalize", r.color)}>{r.val}</span>
                </div>
              ))}
            </div>
            <div className="pt-3 border-t border-[#1E3025]">
              <Link href={`/repositories/${repository?.id}`}>
                <button
                  onClick={onViewFinding}
                  className="w-full flex items-center justify-center gap-2 h-9 bg-[#2E7D32]/15 hover:bg-[#2E7D32]/25 border border-[#2E7D32]/30 text-[#4CAF50] text-[12px] font-semibold rounded-xl transition-colors"
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  Review {openFindings.length} findings
                </button>
              </Link>
            </div>
          </motion.div>

          {/* Timeline */}
          <motion.div
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, delay: 0.18 }}
          >
            <Timeline />
          </motion.div>
        </div>
      </div>
    </div>
  );
};
