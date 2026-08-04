"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, Play, RefreshCw, GitBranch, Clock, FileCode2,
  ShieldAlert, CheckCircle2, BarChart3, History,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { AppShell } from "@/components/layout/AppShell";
import { Skeleton } from "@/components/shared/Skeleton";
import { Toast, ToastMessage } from "@/components/shared/Toast";
import { OverviewTab } from "@/components/repositories/tabs/OverviewTab";
import { FindingsTab } from "@/components/repositories/tabs/FindingsTab";
import { HealthTab } from "@/components/repositories/tabs/HealthTab";
import { HistoryTab } from "@/components/repositories/tabs/HistoryTab";
import { repositoryService } from "@/services/repository.service";
import { reviewService } from "@/services/review.service";
import { findingService } from "@/services/finding.service";
import { Repository, Review, Finding } from "@/types";
import { StartReviewModal } from "@/components/repositories/StartReviewModal";
import { cn } from "@/lib/utils";

type TabId = "overview" | "findings" | "health" | "history";

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: "overview",  label: "Overview",       icon: GitBranch   },
  { id: "findings",  label: "Findings",        icon: ShieldAlert },
  { id: "health",    label: "Health",          icon: BarChart3   },
  { id: "history",   label: "History",         icon: History     },
];

function HealthRing({ score, size = 64 }: { score: number; size?: number }) {
  const r = (size / 2) - 5;
  const circ = 2 * Math.PI * r;
  const color = score >= 80 ? "#4CAF50" : score >= 60 ? "#F59E0B" : "#EF4444";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1E3025" strokeWidth="4"/>
      <motion.circle
        cx={size/2} cy={size/2} r={r} fill="none"
        stroke={color} strokeWidth="4" strokeLinecap="round"
        strokeDasharray={circ}
        initial={{ strokeDashoffset: circ }}
        animate={{ strokeDashoffset: circ - (score / 100) * circ }}
        transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1], delay: 0.3 }}
      />
    </svg>
  );
}

export default function RepositoryDetailPage() {
  const params   = useParams();
  const router   = useRouter();
  const repoId   = params.id as string;

  const [activeTab, setActiveTab]           = useState<TabId>("overview");
  const [repository, setRepository]         = useState<Repository | null>(null);
  const [reviews, setReviews]               = useState<Review[]>([]);
  const [findings, setFindings]             = useState<Finding[]>([]);
  const [isLoadingRepo, setIsLoadingRepo]   = useState(true);
  const [isStartReviewOpen, setIsReviewOpen]= useState(false);
  const [toast, setToast]                   = useState<ToastMessage | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoadingRepo(true);
    try {
      const [repo, reviewList] = await Promise.all([
        repositoryService.getRepositoryById(repoId),
        reviewService.getReviewsByRepoId(repoId),
      ]);
      setRepository(repo);
      setReviews(reviewList);
      if (reviewList.length > 0) {
        const list = await findingService.getFindingsByReviewId(reviewList[0].id);
        setFindings(list);
      }
    } catch {
      setToast({ id: Date.now().toString(), type: "danger", message: "Failed to load repository data." });
    } finally {
      setIsLoadingRepo(false);
    }
  }, [repoId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleReviewComplete = () => {
    setToast({ id: Date.now().toString(), type: "success", message: "Review completed — findings updated." });
    fetchData();
    setActiveTab("findings");
  };

  const latestReview  = reviews[0];
  const openFindings  = findings.filter((f) => f.status === "open");
  const criticalCount = findings.filter((f) => f.severity === "critical" && f.status === "open").length;
  const healthScore   = repository?.healthScore ?? 0;
  const healthColor   = healthScore >= 80 ? "text-success" : healthScore >= 60 ? "text-warning" : "text-danger";

  return (
    <AppShell>
      <div className="space-y-0">

        {/* ── Premium page header ── */}
        <div className="pb-6 space-y-5">
          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-[12px] text-[#7E8A84]">
            <button
              onClick={() => router.push("/repositories")}
              className="flex items-center gap-1.5 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Repositories
            </button>
            <span>/</span>
            {isLoadingRepo
              ? <Skeleton className="h-4 w-32" />
              : <span className="text-white font-medium">{repository?.name}</span>
            }
          </div>

          {/* Hero header row */}
          {isLoadingRepo ? (
            <div className="flex items-center gap-6">
              <Skeleton className="w-16 h-16 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-7 w-64" />
                <Skeleton className="h-4 w-96" />
              </div>
            </div>
          ) : repository && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              className="flex flex-col sm:flex-row sm:items-center gap-5"
            >
              {/* Health ring */}
              <div className="relative shrink-0 w-16 h-16">
                <HealthRing score={healthScore} size={64} />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className={cn("text-[13px] font-bold font-mono", healthColor)}>{healthScore}</span>
                </div>
              </div>

              {/* Identity */}
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-bold text-white tracking-tight">{repository.name}</h1>
                  <span className="px-2 py-0.5 rounded-lg text-[10px] font-mono bg-[#0B120F] border border-[#1E3025] text-[#7E8A84]">
                    {repository.primaryLanguage}
                  </span>
                  {criticalCount > 0 && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[#EF4444]/10 border border-[#EF4444]/30 text-[#EF4444] text-[11px] font-bold">
                      <ShieldAlert className="w-3 h-3" />{criticalCount} critical
                    </span>
                  )}
                  {latestReview?.status === "completed" && (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-[#4CAF50]/10 border border-[#4CAF50]/30 text-[#4CAF50] text-[11px] font-semibold">
                      <CheckCircle2 className="w-3 h-3" />Reviewed
                    </span>
                  )}
                </div>
                <p className="text-[13px] text-[#AAB5AF] mt-1 truncate">{repository.description}</p>
                <div className="flex flex-wrap items-center gap-4 mt-2 text-[11px] text-[#7E8A84]">
                  <span className="flex items-center gap-1"><GitBranch className="w-3 h-3" />{repository.branch}</span>
                  <span className="flex items-center gap-1"><FileCode2 className="w-3 h-3" />{repository.fileCount} files</span>
                  {latestReview && <span className="flex items-center gap-1"><Clock className="w-3 h-3" />Reviewed {repository.updatedAt}</span>}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={fetchData}
                  className="flex items-center gap-1.5 h-9 px-3 border border-[#1E3025] hover:border-[#294134] hover:bg-[#16211B] text-[#7E8A84] hover:text-white text-[12px] rounded-xl transition-all"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Refresh</span>
                </button>
                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setIsReviewOpen(true)}
                  className="flex items-center gap-2 h-9 px-5 bg-[#2E7D32] hover:bg-[#388E3C] text-white text-[13px] font-bold rounded-xl transition-colors"
                >
                  <Play className="w-3.5 h-3.5" />
                  Run Review
                </motion.button>
              </div>
            </motion.div>
          )}

          {/* ── Premium Tab Bar ── */}
          <div className="flex items-end border-b border-[#1E3025] gap-1 -mb-px">
            {TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              const Icon = tab.icon;
              let badge: number | null = null;
              if (tab.id === "findings") badge = openFindings.length;
              if (tab.id === "history")  badge = reviews.length;

              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "relative flex items-center gap-2 px-4 py-2.5 text-[13px] font-medium transition-all rounded-t-xl border border-b-0",
                    isActive
                      ? "bg-[#101915] border-[#1E3025] text-white"
                      : "border-transparent text-[#7E8A84] hover:text-[#AAB5AF] hover:bg-[#0B120F]/60"
                  )}
                >
                  <Icon className={cn("w-3.5 h-3.5", isActive ? "text-[#2E7D32]" : "text-[#7E8A84]")} />
                  {tab.label}
                  {badge !== null && badge > 0 && (
                    <span className={cn(
                      "px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold",
                      isActive
                        ? tab.id === "findings" ? "bg-[#EF4444]/20 text-[#EF4444]" : "bg-[#2E7D32]/20 text-[#2E7D32]"
                        : "bg-[#1E3025] text-[#7E8A84]"
                    )}>
                      {badge}
                    </span>
                  )}
                  {isActive && (
                    <motion.span
                      layoutId="activeTabIndicator"
                      className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#2E7D32] rounded-t-full"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Tab Content ── */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="pt-2"
          >
            {activeTab === "overview" && (
              <OverviewTab repository={repository} latestReview={latestReview} findings={findings} isLoading={isLoadingRepo} onStartReview={() => setIsReviewOpen(true)} onViewFinding={() => setActiveTab("findings")} />
            )}
            {activeTab === "findings" && (
              <FindingsTab repoId={repoId} latestReview={latestReview} initialFindings={findings} isLoading={isLoadingRepo} onFindingUpdated={fetchData} />
            )}
            {activeTab === "health" && (
              <HealthTab repoId={repoId} isLoading={isLoadingRepo} />
            )}
            {activeTab === "history" && (
              <HistoryTab reviews={reviews} isLoading={isLoadingRepo} onStartReview={() => setIsReviewOpen(true)} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {repository && (
        <StartReviewModal isOpen={isStartReviewOpen} onClose={() => setIsReviewOpen(false)} onComplete={handleReviewComplete} repoName={repository.name} />
      )}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </AppShell>
  );
}
