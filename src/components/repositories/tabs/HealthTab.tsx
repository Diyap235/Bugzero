"use client";

import React, { useState, useEffect, useRef } from "react";
import { HealthData } from "@/types";
import { healthService } from "@/services/health.service";
import { WeakModulesTable } from "@/components/health/WeakModulesTable";
import { Skeleton } from "@/components/shared/Skeleton";
import { BarChart3, Zap, TrendingUp, Shield } from "lucide-react";
import { motion, useInView } from "framer-motion";
import { cn } from "@/lib/utils";

// ── Animated counter ──────────────────────────────────────────────────────────
function Counter({ to, suffix = "" }: { to: number; suffix?: string }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true });
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!inView) return;
    let n = 0;
    const step = Math.max(1, Math.floor(to / 40));
    const t = setInterval(() => {
      n = Math.min(n + step, to);
      setVal(n);
      if (n >= to) clearInterval(t);
    }, 24);
    return () => clearInterval(t);
  }, [inView, to]);
  return <span ref={ref}>{val}{suffix}</span>;
}

// ── Animated SVG trend chart ──────────────────────────────────────────────────
function TrendChart({ data }: { data: { date: string; score: number }[] }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true });
  const [period, setPeriod] = useState("30 Days");

  const W = 600; const H = 160;
  const pad = 4;
  const pts = data.map((d, i) => ({
    x: pad + (i / (data.length - 1)) * (W - pad * 2),
    y: H - pad - ((d.score - 60) / 40) * (H - pad * 2),
    score: d.score,
    date: d.date,
  }));
  const polyline = pts.map((p) => `${p.x},${p.y}`).join(" ");
  const area = `${pts[0].x},${H} ` + pts.map((p) => `${p.x},${p.y}`).join(" ") + ` ${pts[pts.length-1].x},${H}`;
  const totalLen = pts.length > 1 ? Math.hypot(pts[pts.length-1].x - pts[0].x, 0) * 2 : 600;

  return (
    <div className="bg-[#101915] border border-[#1E3025] rounded-2xl p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[14px] font-bold text-white">Quality & Health Trend</h3>
          <p className="text-[11px] text-[#7E8A84] mt-0.5">Repository health over time</p>
        </div>
        <div className="flex items-center gap-1 p-1 bg-[#0B120F] border border-[#1E3025] rounded-xl">
          {["7 Days","30 Days","90 Days"].map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                "px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all",
                period === p ? "bg-[#2E7D32] text-white font-bold" : "text-[#7E8A84] hover:text-white"
              )}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div ref={ref} className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-36 overflow-visible">
          {/* Grid */}
          {[60,70,80,90,100].map((v) => {
            const y = H - pad - ((v - 60) / 40) * (H - pad * 2);
            return (
              <g key={v}>
                <line x1={pad} y1={y} x2={W - pad} y2={y} stroke="#1E3025" strokeDasharray="3" />
                <text x={pad - 2} y={y + 4} fill="#7E8A84" fontSize="9" textAnchor="end">{v}</text>
              </g>
            );
          })}
          {/* Area fill */}
          {inView && (
            <motion.polygon
              points={area}
              fill="url(#healthGrad)"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.4 }}
            />
          )}
          <defs>
            <linearGradient id="healthGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2E7D32" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#2E7D32" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {/* Line */}
          {inView && (
            <motion.polyline
              fill="none" stroke="#4CAF50" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              points={polyline}
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
              style={{ pathLength: undefined, strokeDasharray: totalLen, strokeDashoffset: 0 }}
            />
          )}
          {/* Dots + labels */}
          {inView && pts.map((pt, i) => (
            <motion.g key={i} initial={{ opacity: 0, scale: 0 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.4 + i * 0.12 }}>
              <circle cx={pt.x} cy={pt.y} r="5" fill="#4CAF50" stroke="#050705" strokeWidth="2.5" />
              <text x={pt.x} y={pt.y - 11} fill="#AAB5AF" fontSize="10" textAnchor="middle" fontFamily="JetBrains Mono">
                {pt.score}%
              </text>
            </motion.g>
          ))}
        </svg>
        {/* Date labels */}
        <div className="flex justify-between text-[10px] text-[#7E8A84] font-mono pt-1 border-t border-[#1E3025] mt-1">
          {data.map((d) => <span key={d.date}>{d.date}</span>)}
        </div>
      </div>
    </div>
  );
}

interface HealthTabProps {
  repoId: string;
  isLoading: boolean;
}

export const HealthTab: React.FC<HealthTabProps> = ({ repoId, isLoading: parentLoading }) => {
  const [healthData, setHealthData] = useState<HealthData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    healthService.getHealthByRepoId(repoId).then((d) => {
      setHealthData(d);
      setIsLoading(false);
    });
  }, [repoId]);

  if (isLoading || parentLoading) {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-3 gap-4">{[1,2,3].map(i => <Skeleton key={i} className="h-32 rounded-2xl" />)}</div>
        <Skeleton className="h-56 rounded-2xl" />
        <div className="grid grid-cols-2 gap-4">{[1,2].map(i => <Skeleton key={i} className="h-40 rounded-2xl" />)}</div>
      </div>
    );
  }

  if (!healthData) return null;

  const scoreCards = [
    { label: "Overall Health",  val: healthData.overallHealth,  icon: TrendingUp, color: "text-[#4CAF50]", bg: "border-[#4CAF50]/20 bg-[#4CAF50]/5",  bar: "bg-[#4CAF50]",  desc: "+12% this month"   },
    { label: "Code Quality",    val: healthData.qualityScore,   icon: BarChart3,  color: "text-[#3B82F6]", bg: "border-[#3B82F6]/20 bg-[#3B82F6]/5",  bar: "bg-[#3B82F6]",  desc: "Quality score"     },
    { label: "Security Score",  val: healthData.securityScore,  icon: Shield,     color: "text-[#F59E0B]", bg: "border-[#F59E0B]/20 bg-[#F59E0B]/5",  bar: "bg-[#F59E0B]",  desc: "Security posture"  },
  ];

  return (
    <div className="space-y-5">

      {/* ── Score cards ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {scoreCards.map((s, i) => {
          const Icon = s.icon;
          return (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08, duration: 0.4 }}
              className={cn("p-5 rounded-2xl border space-y-4", s.bg)}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-[#7E8A84] uppercase tracking-wider font-semibold">{s.label}</span>
                <Icon className={cn("w-4 h-4", s.color)} />
              </div>
              <div className="flex items-baseline gap-2">
                <span className={cn("text-4xl font-bold font-mono", s.color)}>
                  <Counter to={s.val} />
                </span>
                <span className="text-[#7E8A84] text-sm">/ 100</span>
              </div>
              <div className="space-y-1.5">
                <div className="h-1.5 bg-[#0B120F] rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${s.val}%` }}
                    transition={{ duration: 1, delay: 0.4 + i * 0.1, ease: [0.22, 1, 0.36, 1] }}
                    className={cn("h-full rounded-full", s.bar)}
                  />
                </div>
                <p className="text-[10px] text-[#7E8A84]">{s.desc}</p>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* ── Animated trend chart ── */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <TrendChart data={healthData.qualityTrend} />
      </motion.div>

      {/* ── Technical Debt + Metrics bento ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Technical Debt */}
        <motion.div
          initial={{ opacity: 0, x: -16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.28 }}
          className="bg-[#101915] border border-[#1E3025] rounded-2xl p-5 space-y-4"
        >
          <h4 className="text-[12px] font-semibold text-[#7E8A84] uppercase tracking-wider flex items-center gap-2">
            <Zap className="w-3.5 h-3.5 text-[#F59E0B]" /> Technical Debt
          </h4>
          <div className="space-y-1">
            {Object.entries(healthData.technicalDebt).map(([key, val]) => (
              <div key={key} className="flex items-center justify-between py-2.5 border-b border-[#1E3025] last:border-0 text-[12px]">
                <span className="text-[#AAB5AF] capitalize">{key.replace(/([A-Z])/g, " $1").trim()}</span>
                <span className="font-mono font-semibold text-white">{val}</span>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Review Metrics */}
        <motion.div
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.28 }}
          className="bg-[#101915] border border-[#1E3025] rounded-2xl p-5 space-y-4"
        >
          <h4 className="text-[12px] font-semibold text-[#7E8A84] uppercase tracking-wider flex items-center gap-2">
            <BarChart3 className="w-3.5 h-3.5 text-[#2E7D32]" /> Review Performance
          </h4>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Avg Review Time",    val: healthData.reviewMetrics.averageReviewTime, color: "text-[#2E7D32]"  },
              { label: "Total Reviews",      val: String(healthData.reviewMetrics.totalReviews), color: "text-white"   },
              { label: "Findings Resolved",  val: String(healthData.reviewMetrics.findingsResolved), color: "text-[#4CAF50]" },
              { label: "Improvement",        val: healthData.reviewMetrics.repositoryImprovement, color: "text-[#4CAF50]" },
            ].map((m) => (
              <div key={m.label} className="bg-[#0B120F] border border-[#1E3025] rounded-xl p-3">
                <span className="text-[10px] text-[#7E8A84] block mb-1">{m.label}</span>
                <span className={cn("text-xl font-bold font-mono", m.color)}>{m.val}</span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* ── Severity distribution ── */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.32 }}
        className="bg-[#101915] border border-[#1E3025] rounded-2xl p-5 space-y-4"
      >
        <h4 className="text-[12px] font-semibold text-[#7E8A84] uppercase tracking-wider">Finding Severity Distribution</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Critical", count: healthData.securityTrend.critical, color: "text-[#EF4444]", bg: "bg-[#EF4444]/10 border-[#EF4444]/20", bar: "bg-[#EF4444]" },
            { label: "High",     count: healthData.securityTrend.high,     color: "text-[#F59E0B]", bg: "bg-[#F59E0B]/10 border-[#F59E0B]/20", bar: "bg-[#F59E0B]" },
            { label: "Medium",   count: healthData.securityTrend.medium,   color: "text-yellow-500", bg: "bg-yellow-500/10 border-yellow-500/20", bar: "bg-yellow-500" },
            { label: "Low",      count: healthData.securityTrend.low,      color: "text-[#3B82F6]", bg: "bg-[#3B82F6]/10 border-[#3B82F6]/20", bar: "bg-[#3B82F6]" },
          ].map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.35 + i * 0.06 }}
              className={cn("p-4 border rounded-xl text-center", s.bg)}
            >
              <p className={cn("text-3xl font-bold font-mono", s.color)}>
                <Counter to={s.count} />
              </p>
              <p className="text-[11px] text-[#7E8A84] uppercase tracking-wider mt-1">{s.label}</p>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* ── Weak Modules ── */}
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.38 }}>
        <WeakModulesTable modules={healthData.weakModules} />
      </motion.div>
    </div>
  );
};
