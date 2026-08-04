"use client";

import React, { useState, useEffect } from "react";
import {
  FileText, Download, Trash2, Eye, Search, X,
  CheckCircle2, FileJson, FileBadge, BarChart3, Calendar,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { AppShell } from "@/components/layout/AppShell";
import { ReportPreviewDrawer } from "@/components/reports/ReportPreviewDrawer";
import { Toast, ToastMessage } from "@/components/shared/Toast";
import { reportService } from "@/services/report.service";
import { Report } from "@/types";
import { formatBytes } from "@/lib/utils";
import { cn } from "@/lib/utils";

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.07 } } };
const fadeUp  = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] as const } } };

function healthColor(score: number) {
  return score >= 80 ? "text-[#4CAF50]" : score >= 60 ? "text-[#F59E0B]" : "text-[#EF4444]";
}

export default function ReportsPage() {
  const [reports, setReports]               = useState<Report[]>([]);
  const [search, setSearch]                 = useState("");
  const [formatFilter, setFormatFilter]     = useState("All");
  const [isLoading, setIsLoading]           = useState(true);
  const [selectedReport, setSelectedReport] = useState<Report | null>(null);
  const [isDrawerOpen, setIsDrawerOpen]     = useState(false);
  const [deletingId, setDeletingId]         = useState<string | null>(null);
  const [toast, setToast]                   = useState<ToastMessage | null>(null);

  const fetchReports = async () => {
    setIsLoading(true);
    try {
      const data = await reportService.getReports(search, formatFilter);
      setReports(data);
    } catch {
      setToast({ id: Date.now().toString(), type: "danger", message: "Failed to load reports." });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { fetchReports(); }, [search, formatFilter]);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await reportService.deleteReport(id);
      setReports((prev) => prev.filter((r) => r.id !== id));
      setToast({ id: Date.now().toString(), type: "success", message: "Report deleted." });
    } catch {
      setToast({ id: Date.now().toString(), type: "danger", message: "Failed to delete report." });
    } finally {
      setDeletingId(null);
    }
  };

  const pdfCount  = reports.filter((r) => r.format === "PDF").length;
  const jsonCount = reports.filter((r) => r.format === "JSON").length;
  const avgHealth = reports.length
    ? Math.round(reports.reduce((s, r) => s + r.healthScore, 0) / reports.length)
    : 0;

  return (
    <AppShell>
      <div className="space-y-6">

        {/* ── Page header ── */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-6 border-b border-[#1E3025]"
        >
          <div>
            <div className="flex items-center gap-2 text-[11px] text-[#7E8A84] mb-2">
              <span>Workspace</span><span>/</span><span className="text-white font-medium">Audit Reports</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              <FileText className="w-6 h-6 text-[#2E7D32]" />
              Audit Reports
            </h1>
            <p className="text-[13px] text-[#AAB5AF] mt-1">
              Download, preview, and manage exported PDF and JSON repository review reports.
            </p>
          </div>
        </motion.div>

        {/* ── Stats row ── */}
        <motion.div
          variants={stagger} initial="hidden" animate="show"
          className="grid grid-cols-2 md:grid-cols-4 gap-4"
        >
          {[
            { label: "Total Reports", val: reports.length,        icon: FileText,  color: "text-white",        bg: "border-[#1E3025] bg-[#101915]"            },
            { label: "PDF Reports",   val: pdfCount,              icon: FileBadge, color: "text-[#EF4444]",    bg: "border-[#EF4444]/20 bg-[#EF4444]/5"        },
            { label: "JSON Reports",  val: jsonCount,             icon: FileJson,  color: "text-[#3B82F6]",    bg: "border-[#3B82F6]/20 bg-[#3B82F6]/5"        },
            { label: "Avg Health",    val: `${avgHealth}%`,       icon: BarChart3, color: "text-[#4CAF50]",    bg: "border-[#4CAF50]/20 bg-[#4CAF50]/5"        },
          ].map((s) => {
            const Icon = s.icon;
            return (
              <motion.div key={s.label} variants={fadeUp} className={cn("flex items-center gap-3 p-4 rounded-2xl border", s.bg)}>
                <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center shrink-0", s.bg)}>
                  <Icon className={cn("w-4 h-4", s.color)} />
                </div>
                <div>
                  <p className={cn("text-xl font-bold font-mono", s.color)}>{s.val}</p>
                  <p className="text-[11px] text-[#7E8A84]">{s.label}</p>
                </div>
              </motion.div>
            );
          })}
        </motion.div>

        {/* ── Toolbar ── */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#7E8A84] pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search reports or repositories…"
              className="w-full h-9 bg-[#0B120F] border border-[#1E3025] rounded-xl pl-8 pr-8 text-[12px] text-white placeholder:text-[#7E8A84] focus:outline-none focus:border-[#2E7D32] transition-colors"
            />
            {search && (
              <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#7E8A84] hover:text-white">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {["All","PDF","JSON"].map((f) => (
              <button
                key={f}
                onClick={() => setFormatFilter(f)}
                className={cn(
                  "px-3 py-1.5 rounded-xl text-[12px] font-medium border transition-all",
                  formatFilter === f
                    ? "bg-[#2E7D32] text-white border-[#2E7D32]"
                    : "border-[#1E3025] text-[#7E8A84] hover:border-[#294134] hover:text-white"
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* ── Reports list ── */}
        {isLoading ? (
          <div className="space-y-3">
            {[1,2,3].map((i) => (
              <div key={i} className="h-20 rounded-2xl bg-[#101915] animate-pulse" />
            ))}
          </div>
        ) : reports.length === 0 ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center py-24 text-center space-y-4 border border-dashed border-[#1E3025] rounded-2xl"
          >
            <div className="w-16 h-16 rounded-2xl bg-[#101915] border border-[#1E3025] flex items-center justify-center">
              <FileText className="w-7 h-7 text-[#7E8A84]" />
            </div>
            <div>
              <p className="text-[15px] font-bold text-white">No reports yet</p>
              <p className="text-[13px] text-[#7E8A84] mt-1">Run a repository review to generate your first audit report.</p>
            </div>
          </motion.div>
        ) : (
          <motion.div variants={stagger} initial="hidden" animate="show" className="space-y-3">
            <AnimatePresence>
              {reports.map((report) => (
                <motion.div
                  key={report.id}
                  variants={fadeUp}
                  exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                  transition={{ duration: 0.25 }}
                  className={cn(
                    "group flex items-center gap-4 p-5 bg-[#101915] border border-[#1E3025] rounded-2xl hover:border-[#294134] transition-all",
                    deletingId === report.id && "opacity-50"
                  )}
                >
                  {/* Format icon */}
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border",
                    report.format === "PDF"
                      ? "bg-[#EF4444]/10 border-[#EF4444]/25 text-[#EF4444]"
                      : "bg-[#3B82F6]/10 border-[#3B82F6]/25 text-[#3B82F6]"
                  )}>
                    {report.format === "PDF" ? <FileBadge className="w-5 h-5" /> : <FileJson className="w-5 h-5" />}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-[14px] font-semibold text-white truncate">{report.reportName}</p>
                      <span className={cn(
                        "px-1.5 py-0.5 rounded-md text-[10px] font-mono font-bold border",
                        report.format === "PDF"
                          ? "bg-[#EF4444]/10 border-[#EF4444]/25 text-[#EF4444]"
                          : "bg-[#3B82F6]/10 border-[#3B82F6]/25 text-[#3B82F6]"
                      )}>
                        {report.format}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-[11px] text-[#7E8A84]">
                      <span className="font-mono truncate">{report.repositoryName}</span>
                      <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{report.reviewDate}</span>
                      <span className="font-mono">{formatBytes(report.sizeBytes)}</span>
                    </div>
                  </div>

                  {/* Health */}
                  <div className="hidden md:block text-right shrink-0">
                    <p className={cn("text-xl font-bold font-mono", healthColor(report.healthScore))}>{report.healthScore}%</p>
                    <p className="text-[10px] text-[#7E8A84]">Health</p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <motion.button
                      whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.95 }}
                      onClick={() => { setSelectedReport(report); setIsDrawerOpen(true); }}
                      className="flex items-center gap-1.5 h-8 px-3 border border-[#1E3025] hover:border-[#294134] hover:bg-[#16211B] text-[#AAB5AF] text-[11px] rounded-xl transition-all"
                    >
                      <Eye className="w-3.5 h-3.5" /> Preview
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.95 }}
                      onClick={() => alert(`Downloading ${report.reportName}…`)}
                      className="flex items-center gap-1.5 h-8 px-3 bg-[#2E7D32]/15 hover:bg-[#2E7D32]/25 border border-[#2E7D32]/30 text-[#4CAF50] text-[11px] rounded-xl transition-all"
                    >
                      <Download className="w-3.5 h-3.5" /> Download
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.95 }}
                      onClick={() => handleDelete(report.id)}
                      disabled={deletingId === report.id}
                      className="flex items-center justify-center w-8 h-8 border border-[#1E3025] hover:border-[#EF4444]/40 hover:bg-[#EF4444]/10 text-[#7E8A84] hover:text-[#EF4444] rounded-xl transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </motion.button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </div>

      <ReportPreviewDrawer report={selectedReport} isOpen={isDrawerOpen} onClose={() => setIsDrawerOpen(false)} />
      <Toast toast={toast} onClose={() => setToast(null)} />
    </AppShell>
  );
}
