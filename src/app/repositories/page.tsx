"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Plus, GitBranch, RefreshCw, Play, ArrowRight, Search, X,
  ShieldAlert, CheckCircle2, Clock, FileCode2, Upload,
  BarChart3, FileText, Zap, ChevronRight, AlertTriangle,
  Cpu, Sparkles, TrendingUp, Circle, Activity,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { AppShell } from "@/components/layout/AppShell";
import { CreateRepositoryDialog } from "@/components/repositories/CreateRepositoryDialog";
import { StartReviewModal } from "@/components/repositories/StartReviewModal";
import { Toast, ToastMessage } from "@/components/shared/Toast";
import { repositoryService } from "@/services/repository.service";
import { Repository } from "@/types";
import { cn } from "@/lib/utils";
import { MOCK_FINDINGS, MOCK_REVIEWS } from "@/lib/mock-data";

// ─── Animation presets ───────────────────────────────────────────────────────
const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  show:   { opacity: 1, y: 0,  transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
};
const staggerList = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };

// ─── Health color helper ──────────────────────────────────────────────────────
function healthColor(score: number) {
  if (score >= 80) return "text-success";
  if (score >= 60) return "text-warning";
  return "text-danger";
}
function healthBg(score: number) {
  if (score >= 80) return "bg-success";
  if (score >= 60) return "bg-warning";
  return "bg-danger";
}
function healthBorder(score: number) {
  if (score >= 80) return "border-success/30";
  if (score >= 60) return "border-warning/30";
  return "border-danger/30";
}

// ─── Activity feed (static but realistic) ────────────────────────────────────
const ACTIVITY = [
  { icon: CheckCircle2, color: "text-success", bg: "bg-success/10",   msg: "Static analysis completed for auth-service-python",     time: "2 min ago"  },
  { icon: AlertTriangle,color: "text-danger",  bg: "bg-danger/10",    msg: "SQL Injection detected in user_repo.py:48 (AI 96%)",    time: "2 min ago"  },
  { icon: Sparkles,     color: "text-primary", bg: "bg-primary/10",   msg: "CodeBERT classified 4 findings with confidence scores", time: "3 min ago"  },
  { icon: CheckCircle2, color: "text-success", bg: "bg-success/10",   msg: "AI explanation generated for Hardcoded Secret (B608)",  time: "3 min ago"  },
  { icon: TrendingUp,   color: "text-info",    bg: "bg-info/10",      msg: "Repository health improved from 81% → 84%",            time: "4 min ago"  },
  { icon: FileText,     color: "text-text-secondary", bg: "bg-surface", msg: "Audit report exported: auth-service-python-audit.pdf", time: "1 day ago"  },
  { icon: CheckCircle2, color: "text-success", bg: "bg-success/10",   msg: "payment-gateway-api review queued",                    time: "1 day ago"  },
];

// ─── Compact Repository Row ───────────────────────────────────────────────────
function RepoRow({
  repo,
  isSelected,
  onSelect,
  onStartReview,
}: {
  repo: Repository;
  isSelected: boolean;
  onSelect: (r: Repository) => void;
  onStartReview: (r: Repository) => void;
}) {
  return (
    <motion.div
      variants={fadeUp}
      onClick={() => onSelect(repo)}
      className={cn(
        "group flex items-center gap-4 px-4 py-3 rounded-xl border transition-all cursor-pointer",
        isSelected
          ? "bg-card border-primary/40 shadow-sm"
          : "border-border hover:border-border-strong hover:bg-surface-hover"
      )}
    >
      {/* Health ring */}
      <div className="relative shrink-0 w-10 h-10">
        <svg viewBox="0 0 36 36" className="w-10 h-10 -rotate-90">
          <circle cx="18" cy="18" r="15" fill="none" stroke="#1E3025" strokeWidth="3" />
          <circle
            cx="18" cy="18" r="15" fill="none"
            stroke={repo.healthScore >= 80 ? "#4CAF50" : repo.healthScore >= 60 ? "#F59E0B" : "#EF4444"}
            strokeWidth="3"
            strokeDasharray={`${(repo.healthScore / 100) * 94.2} 94.2`}
            strokeLinecap="round"
          />
        </svg>
        <span className={cn("absolute inset-0 flex items-center justify-center text-[10px] font-bold font-mono", healthColor(repo.healthScore))}>
          {repo.healthScore}
        </span>
      </div>

      {/* Name + meta */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-text-primary truncate">{repo.name}</span>
          <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono bg-surface border border-border text-text-muted">
            {repo.primaryLanguage}
          </span>
          {repo.criticalFindingsCount > 0 && (
            <span className="shrink-0 flex items-center gap-0.5 text-[10px] text-danger font-semibold">
              <ShieldAlert className="w-3 h-3" />{repo.criticalFindingsCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-[11px] text-text-muted">
          <span className="flex items-center gap-1"><GitBranch className="w-3 h-3" />{repo.branch}</span>
          <span className="flex items-center gap-1"><FileCode2 className="w-3 h-3" />{repo.fileCount} files</span>
          <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{repo.updatedAt}</span>
        </div>
      </div>

      {/* Findings pill */}
      <div className="hidden sm:flex items-center gap-1.5 shrink-0">
        <span className="px-2 py-1 rounded-lg bg-surface border border-border text-[11px] font-mono text-text-secondary">
          {repo.openFindingsCount} open
        </span>
      </div>

      {/* Action */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={(e) => { e.stopPropagation(); onStartReview(repo); }}
          className="opacity-0 group-hover:opacity-100 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-primary hover:bg-primary-hover text-white text-[11px] font-semibold transition-all"
        >
          <Play className="w-3 h-3" /> Review
        </button>
        <Link href={`/repositories/${repo.id}`} onClick={(e) => e.stopPropagation()}>
          <span className="flex items-center justify-center w-7 h-7 rounded-lg border border-border hover:bg-surface-hover transition-colors">
            <ArrowRight className="w-3.5 h-3.5 text-text-muted" />
          </span>
        </Link>
      </div>
    </motion.div>
  );
}

// ─── Repository Preview Panel ─────────────────────────────────────────────────
function RepoPreviewPanel({ repo }: { repo: Repository | null }) {
  if (!repo) return null;

  const repoFindings = MOCK_FINDINGS.filter((f) => f.repositoryId === repo.id).slice(0, 3);
  const repoReview  = MOCK_REVIEWS.find((r) => r.repositoryId === repo.id);

  const files = [
    { name: "user_repo.py",    issues: 2, color: "text-danger"  },
    { name: "config.py",       issues: 1, color: "text-warning" },
    { name: "error_handler.py",issues: 1, color: "text-warning" },
    { name: "security.py",     issues: 0, color: "text-success" },
    { name: "__init__.py",     issues: 0, color: "text-text-muted" },
  ];

  return (
    <motion.div
      key={repo.id}
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 12 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className="h-full bg-card border border-border rounded-2xl overflow-hidden flex flex-col"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-border bg-surface/60">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <GitBranch className="w-3.5 h-3.5 text-primary" />
            <span className="text-[12px] font-semibold text-text-primary truncate">{repo.name}</span>
          </div>
          <span className={cn("text-[11px] font-bold font-mono", healthColor(repo.healthScore))}>
            {repo.healthScore}% health
          </span>
        </div>
        <p className="text-[11px] text-text-muted mt-1 line-clamp-1">{repo.description}</p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Health bar */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-[11px]">
            <span className="text-text-muted font-semibold uppercase tracking-wider">Health Score</span>
            <span className={cn("font-mono font-bold", healthColor(repo.healthScore))}>{repo.healthScore}/100</span>
          </div>
          <div className="h-1.5 bg-surface rounded-full border border-border overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${repo.healthScore}%` }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              className={cn("h-full rounded-full", healthBg(repo.healthScore))}
            />
          </div>
        </div>

        {/* File tree */}
        <div className="space-y-1.5">
          <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Repository Tree</span>
          <div className="bg-[#050705] border border-border rounded-xl p-3 font-mono text-[11px] space-y-1">
            <div className="flex items-center gap-1.5 text-text-muted mb-1">
              <FileCode2 className="w-3 h-3 text-warning" />
              <span>{repo.name}/</span>
            </div>
            {files.map((f) => (
              <div key={f.name} className="flex items-center justify-between pl-4">
                <div className="flex items-center gap-1.5 text-text-secondary">
                  <span className="w-2 h-px bg-border" />
                  <span>{f.name}</span>
                </div>
                {f.issues > 0 && (
                  <span className={cn("text-[10px] font-semibold", f.color)}>{f.issues} iss.</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Recent findings */}
        {repoFindings.length > 0 && (
          <div className="space-y-1.5">
            <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">Recent Findings</span>
            <div className="space-y-1.5">
              {repoFindings.map((f) => (
                <div key={f.id} className={cn(
                  "flex items-start gap-2 p-2.5 rounded-lg border text-[11px]",
                  f.severity === "critical" ? "border-danger/25 bg-danger/5" :
                  f.severity === "high"     ? "border-warning/25 bg-warning/5" :
                  "border-border bg-surface/40"
                )}>
                  <span className={cn(
                    "shrink-0 mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase",
                    f.severity === "critical" ? "bg-danger/20 text-danger" :
                    f.severity === "high"     ? "bg-warning/20 text-warning" :
                    "bg-surface text-text-muted"
                  )}>
                    {f.severity}
                  </span>
                  <span className="text-text-secondary line-clamp-1 leading-tight">{f.title}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* AI status */}
        <div className="bg-surface border border-border rounded-xl p-3 space-y-2">
          <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">AI Review Status</span>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            {[
              { label: "Last Scan",  val: repo.updatedAt,              color: "text-text-secondary" },
              { label: "Duration",   val: repoReview?.duration ?? "—", color: "text-text-secondary" },
              { label: "Reviewer",   val: "BugZero AI v2.1",           color: "text-primary"        },
              { label: "Status",     val: repoReview?.status ?? "—",   color: "text-success"        },
            ].map((m) => (
              <div key={m.label}>
                <span className="text-text-muted block text-[10px]">{m.label}</span>
                <span className={cn("font-semibold capitalize", m.color)}>{m.val}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Footer CTA */}
      <div className="p-3 border-t border-border shrink-0">
        <Link href={`/repositories/${repo.id}`} className="block">
          <button className="w-full flex items-center justify-center gap-2 h-9 bg-primary hover:bg-primary-hover text-white text-[12px] font-semibold rounded-xl transition-colors">
            <Play className="w-3.5 h-3.5" />
            Open Repository
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </Link>
      </div>
    </motion.div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function RepositoriesPage() {
  const router = useRouter();
  const [repositories, setRepositories]         = useState<Repository[]>([]);
  const [search, setSearch]                     = useState("");
  const [selectedLanguage, setSelectedLanguage] = useState("All");
  const [isLoading, setIsLoading]               = useState(true);
  const [isCreateOpen, setIsCreateOpen]         = useState(false);
  const [reviewTarget, setReviewTarget]         = useState<Repository | null>(null);
  const [selectedRepo, setSelectedRepo]         = useState<Repository | null>(null);
  const [toast, setToast]                       = useState<ToastMessage | null>(null);
  const searchRef                               = useRef<HTMLInputElement>(null);

  // "/" shortcut
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, []);

  const fetchRepos = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await repositoryService.getRepositories(search, selectedLanguage);
      setRepositories(data);
      if (!selectedRepo && data.length > 0) setSelectedRepo(data[0]);
    } catch {
      setToast({ id: Date.now().toString(), type: "danger", message: "Failed to load repositories." });
    } finally {
      setIsLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, selectedLanguage]);

  useEffect(() => { fetchRepos(); }, [fetchRepos]);

  const handleCreate = async (name: string, description: string, language: string) => {
    const repo = await repositoryService.createRepository(name, description, language);
    await fetchRepos();
    setSelectedRepo(repo);
    setToast({ id: Date.now().toString(), type: "success", message: `Repository "${name}" created.` });
  };

  const handleReviewComplete = () => {
    setToast({ id: Date.now().toString(), type: "success", message: "Review completed — findings updated." });
    if (reviewTarget) router.push(`/repositories/${reviewTarget.id}?tab=findings`);
    setReviewTarget(null);
  };

  // Aggregate KPIs
  const totalOpen    = repositories.reduce((s, r) => s + r.openFindingsCount, 0);
  const totalCrit    = repositories.reduce((s, r) => s + r.criticalFindingsCount, 0);
  const avgHealth    = repositories.length
    ? Math.round(repositories.reduce((s, r) => s + r.healthScore, 0) / repositories.length)
    : 0;

  const primaryRepo = repositories[0] ?? null;

  const LANGUAGE_OPTIONS = [
    { label: "All", value: "All" },
    { label: "Python", value: "Python" },
    { label: "TypeScript", value: "TypeScript" },
    { label: "Go", value: "Go" },
  ];

  return (
    <AppShell>
      <div className="space-y-6">

        {/* ── KPI strip ──────────────────────────────────────────────── */}
        <motion.div
          variants={staggerList}
          initial="hidden"
          animate="show"
          className="grid grid-cols-2 lg:grid-cols-4 gap-3"
        >
          {[
            { label: "Repositories",    value: isLoading ? "—" : repositories.length, icon: GitBranch,    color: "text-primary",  dim: "bg-primary/10 border-primary/25"  },
            { label: "Open Findings",   value: isLoading ? "—" : totalOpen,           icon: Activity,     color: "text-warning",  dim: "bg-warning/10 border-warning/25"  },
            { label: "Critical Issues", value: isLoading ? "—" : totalCrit,           icon: ShieldAlert,  color: "text-danger",   dim: "bg-danger/10 border-danger/25"    },
            { label: "Avg Health",      value: isLoading ? "—" : `${avgHealth}%`,     icon: BarChart3,    color: "text-success",  dim: "bg-success/10 border-success/25"  },
          ].map((kpi) => {
            const Icon = kpi.icon;
            return (
              <motion.div
                key={kpi.label}
                variants={fadeUp}
                className={cn("flex items-center gap-3 p-4 rounded-xl border", kpi.dim)}
              >
                <div className={cn("w-8 h-8 rounded-lg border flex items-center justify-center shrink-0", kpi.dim)}>
                  <Icon className={cn("w-4 h-4", kpi.color)} />
                </div>
                <div>
                  <p className={cn("text-xl font-bold font-mono leading-none", kpi.color)}>{kpi.value}</p>
                  <p className="text-[11px] text-text-muted mt-0.5">{kpi.label}</p>
                </div>
              </motion.div>
            );
          })}
        </motion.div>

        {/* ── Hero: Active workspace panel ──────────────────────────── */}
        {primaryRepo && !isLoading && (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
            className="relative overflow-hidden bg-card border border-border rounded-2xl p-6"
          >
            {/* Subtle glow */}
            <div className="absolute top-0 right-0 w-64 h-32 rounded-full opacity-[0.06] pointer-events-none"
              style={{ background: "radial-gradient(ellipse, #2E7D32, transparent 70%)", transform: "translate(30%, -40%)" }}
            />

            <div className="flex flex-col lg:flex-row items-start gap-6">
              {/* Left: Workspace identity */}
              <div className="flex-1 min-w-0 space-y-4">
                {/* Active repo label */}
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/15 border border-primary/30 text-[11px] font-semibold text-primary">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse inline-block" />
                    Active Workspace
                  </span>
                  <span className="text-[11px] text-text-muted font-mono">Last reviewed {primaryRepo.updatedAt}</span>
                </div>

                <div>
                  <h2 className="text-2xl font-bold tracking-tight text-text-primary flex items-center gap-3">
                    <GitBranch className="w-5 h-5 text-primary shrink-0" />
                    {primaryRepo.name}
                  </h2>
                  <p className="text-sm text-text-secondary mt-1 max-w-lg">{primaryRepo.description}</p>
                </div>

                {/* Metric row */}
                <div className="flex flex-wrap items-center gap-5">
                  <div>
                    <span className="text-[10px] text-text-muted uppercase tracking-wider block">Health</span>
                    <span className={cn("text-3xl font-bold font-mono", healthColor(primaryRepo.healthScore))}>
                      {primaryRepo.healthScore}
                      <span className="text-base text-text-muted">/100</span>
                    </span>
                  </div>
                  <div className="w-px h-10 bg-border" />
                  <div>
                    <span className="text-[10px] text-text-muted uppercase tracking-wider block">Open Findings</span>
                    <span className="text-3xl font-bold font-mono text-text-primary">{primaryRepo.openFindingsCount}</span>
                  </div>
                  <div className="w-px h-10 bg-border" />
                  <div>
                    <span className="text-[10px] text-text-muted uppercase tracking-wider block">Critical</span>
                    <span className={cn("text-3xl font-bold font-mono", primaryRepo.criticalFindingsCount > 0 ? "text-danger" : "text-success")}>
                      {primaryRepo.criticalFindingsCount}
                    </span>
                  </div>
                  <div className="w-px h-10 bg-border" />
                  <div>
                    <span className="text-[10px] text-text-muted uppercase tracking-wider block">Files</span>
                    <span className="text-3xl font-bold font-mono text-text-primary">{primaryRepo.fileCount}</span>
                  </div>
                </div>

                {/* Health bar */}
                <div className="space-y-1 max-w-sm">
                  <div className="flex justify-between text-[11px] text-text-muted">
                    <span>Repository Health</span>
                    <span className={healthColor(primaryRepo.healthScore)}>{primaryRepo.healthScore}%</span>
                  </div>
                  <div className="h-2 bg-surface rounded-full border border-border overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${primaryRepo.healthScore}%` }}
                      transition={{ duration: 0.8, delay: 0.3, ease: "easeOut" }}
                      className={cn("h-full rounded-full", healthBg(primaryRepo.healthScore))}
                    />
                  </div>
                </div>
              </div>

              {/* Right: CTA block */}
              <div className="flex flex-col gap-3 shrink-0 w-full lg:w-auto">
                <Link href={`/repositories/${primaryRepo.id}`}>
                  <motion.button
                    whileHover={{ scale: 1.02, boxShadow: "0 0 24px rgba(46,125,50,0.3)" }}
                    whileTap={{ scale: 0.98 }}
                    className="w-full lg:w-auto flex items-center justify-center gap-2.5 h-12 px-8 bg-primary hover:bg-primary-hover text-white text-[14px] font-bold rounded-xl transition-all"
                  >
                    <Play className="w-4 h-4" />
                    Continue Review
                  </motion.button>
                </Link>
                <button
                  onClick={() => setReviewTarget(primaryRepo)}
                  className="w-full lg:w-auto flex items-center justify-center gap-2 h-10 px-6 border border-border hover:border-border-strong hover:bg-surface-hover text-text-secondary hover:text-text-primary text-[13px] font-medium rounded-xl transition-all"
                >
                  <Zap className="w-3.5 h-3.5" />
                  Run New AI Review
                </button>
                <Link href={`/repositories/${primaryRepo.id}?tab=findings`}>
                  <button className="w-full flex items-center justify-center gap-2 h-10 px-6 border border-border hover:border-border-strong hover:bg-surface-hover text-text-secondary hover:text-text-primary text-[13px] font-medium rounded-xl transition-all">
                    <ShieldAlert className="w-3.5 h-3.5 text-danger" />
                    View {primaryRepo.openFindingsCount} Open Findings
                  </button>
                </Link>
              </div>
            </div>
          </motion.div>
        )}

        {/* ── Quick Actions ─────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.2 }}
        >
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[11px] font-semibold text-text-muted uppercase tracking-widest">Quick Actions</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
            {[
              { label: "New Repository", icon: Plus,       action: () => setIsCreateOpen(true),                   accent: "hover:border-primary/40 hover:text-primary" },
              { label: "Run AI Review",  icon: Zap,        action: () => primaryRepo && setReviewTarget(primaryRepo), accent: "hover:border-success/40 hover:text-success" },
              { label: "Upload Files",   icon: Upload,      action: () => primaryRepo && setReviewTarget(primaryRepo), accent: "hover:border-info/40 hover:text-info"    },
              { label: "View Reports",   icon: FileText,    action: () => router.push("/reports"),                 accent: "hover:border-warning/40 hover:text-warning" },
              { label: "Refresh",        icon: RefreshCw,   action: fetchRepos,                                    accent: "hover:border-border-strong hover:text-text-primary" },
            ].map((a) => {
              const Icon = a.icon;
              return (
                <motion.button
                  key={a.label}
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={a.action}
                  className={cn(
                    "flex flex-col items-center justify-center gap-2 p-4 rounded-xl border border-border bg-surface text-text-secondary text-[12px] font-medium transition-all",
                    a.accent
                  )}
                >
                  <Icon className="w-4 h-4" />
                  <span className="text-center leading-tight">{a.label}</span>
                </motion.button>
              );
            })}
          </div>
        </motion.div>

        {/* ── Main content: repo list + preview + activity ──────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_288px] gap-5">

          {/* Left column */}
          <div className="space-y-5 min-w-0">

            {/* ── Repository list ── */}
            <div>
              {/* List toolbar */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-3">
                <div className="flex items-center gap-2 flex-1">
                  <span className="text-[11px] font-semibold text-text-muted uppercase tracking-widest shrink-0">
                    Repositories
                  </span>
                  {!isLoading && (
                    <span className="px-1.5 py-0.5 rounded-md bg-surface border border-border text-[10px] font-mono text-text-muted">
                      {repositories.length}
                    </span>
                  )}
                </div>

                {/* Search */}
                <div className="relative sm:w-64">
                  <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                  <input
                    ref={searchRef}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search… (/)"
                    className="w-full h-9 bg-surface border border-border rounded-xl pl-8 pr-8 text-[12px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary transition-colors"
                  />
                  {search && (
                    <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Language filters */}
                <div className="flex items-center gap-1.5">
                  {LANGUAGE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setSelectedLanguage(opt.value)}
                      className={cn(
                        "px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-all",
                        selectedLanguage === opt.value
                          ? "bg-primary text-white border-primary"
                          : "border-border text-text-secondary hover:border-border-strong hover:text-text-primary"
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Repo rows */}
              {isLoading ? (
                <div className="space-y-2">
                  {[1,2,3,4].map((i) => (
                    <div key={i} className="h-16 rounded-xl bg-surface-hover/60 animate-pulse" />
                  ))}
                </div>
              ) : repositories.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-border rounded-2xl space-y-3">
                  <GitBranch className="w-10 h-10 text-text-muted" />
                  <div>
                    <p className="text-sm font-semibold text-text-primary">No repositories found</p>
                    <p className="text-xs text-text-secondary mt-1">Create your first repository to begin AI code reviews.</p>
                  </div>
                  <button
                    onClick={() => setIsCreateOpen(true)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-primary hover:bg-primary-hover text-white text-[12px] font-semibold rounded-xl transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" /> Create Repository
                  </button>
                </div>
              ) : (
                <motion.div
                  variants={staggerList}
                  initial="hidden"
                  animate="show"
                  className="space-y-2"
                >
                  {repositories.map((repo) => (
                    <RepoRow
                      key={repo.id}
                      repo={repo}
                      isSelected={selectedRepo?.id === repo.id}
                      onSelect={setSelectedRepo}
                      onStartReview={setReviewTarget}
                    />
                  ))}
                </motion.div>
              )}
            </div>

            {/* ── Engineering Activity ── */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-semibold text-text-muted uppercase tracking-widest">
                  Engineering Activity
                </span>
                <span className="flex items-center gap-1 text-[10px] text-success font-mono">
                  <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse inline-block" />
                  Live
                </span>
              </div>
              <div className="bg-card border border-border rounded-2xl overflow-hidden divide-y divide-border">
                {ACTIVITY.map((item, i) => {
                  const Icon = item.icon;
                  return (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 + 0.3, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-hover transition-colors"
                    >
                      <div className={cn("w-6 h-6 rounded-lg flex items-center justify-center shrink-0", item.bg)}>
                        <Icon className={cn("w-3.5 h-3.5", item.color)} />
                      </div>
                      <span className="flex-1 text-[12px] text-text-secondary min-w-0 truncate">{item.msg}</span>
                      <span className="text-[10px] text-text-muted font-mono shrink-0">{item.time}</span>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right column: repository preview panel */}
          <div className="hidden xl:flex flex-col">
            <div className="sticky top-[88px]">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] font-semibold text-text-muted uppercase tracking-widest">
                  Preview
                </span>
                {selectedRepo && (
                  <span className="text-[10px] text-text-muted font-mono truncate max-w-[160px]">
                    {selectedRepo.name}
                  </span>
                )}
              </div>
              <div style={{ height: 540 }}>
                <AnimatePresence mode="wait">
                  {selectedRepo ? (
                    <RepoPreviewPanel key={selectedRepo.id} repo={selectedRepo} />
                  ) : (
                    <motion.div
                      key="empty"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="h-full flex items-center justify-center border border-dashed border-border rounded-2xl"
                    >
                      <div className="text-center text-text-muted space-y-2">
                        <GitBranch className="w-8 h-8 mx-auto" />
                        <p className="text-[12px]">Select a repository to preview</p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Dialogs ── */}
      <CreateRepositoryDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreate={handleCreate}
      />

      {reviewTarget && (
        <StartReviewModal
          isOpen={true}
          onClose={() => setReviewTarget(null)}
          onComplete={handleReviewComplete}
          repoName={reviewTarget.name}
        />
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </AppShell>
  );
}
