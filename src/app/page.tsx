"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ShieldCheck, ArrowRight, Sparkles, Zap, Lock, Code2, FileCheck,
  BarChart3, CheckCircle2, XCircle, HelpCircle, Github, ChevronDown,
  AlertTriangle, Shield, GitBranch, Terminal, Play, Cpu, TrendingUp,
  FileCode2, FolderOpen, Circle, Minus, Square,
} from "lucide-react";
import {
  motion, useScroll, useTransform, useInView, AnimatePresence,
} from "framer-motion";
import { sampleWorkspace } from "@/domains/product/sample-data";

// ─── Animation helpers ────────────────────────────────────────────────────────
const fadeUp = {
  hidden: { opacity: 0, y: 28 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] } },
};

const stagger = (delay = 0.1) => ({
  hidden: {},
  show: { transition: { staggerChildren: delay } },
});

function FadeIn({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 32 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ─── VS Code Workspace Mock ───────────────────────────────────────────────────
const CODE_LINES = sampleWorkspace.codeLines;
const sampleSqlFinding = sampleWorkspace.findings[0];
const sampleSqlDetail = sampleSqlFinding ? sampleWorkspace.findingDetails[sampleSqlFinding.finding.id] : undefined;
const sampleSqlEvidence = sampleSqlDetail?.evidence;
const sampleSourceFile = sampleSqlFinding?.occurrence?.filePath ?? "users.ts";
const sampleSourceName = sampleSourceFile.split("/").at(-1) ?? "users.ts";
const landingData = {
  overview: sampleWorkspace.overview,
  findings: sampleWorkspace.findings,
  healthHistory: sampleWorkspace.healthHistory,
};

const LINE_COLORS: Record<string, string> = {
  import: "text-info",
  def: "text-primary",
  code: "text-text-secondary",
  danger: "text-danger/90",
  blank: "",
};

function VSCodeWorkspace() {
  const visibleLines = CODE_LINES.length;
  const [findingVisible, setFindingVisible] = useState(false);
  const [panelVisible, setPanelVisible] = useState(false);
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });

  useEffect(() => {
    if (!inView) return;
    const findingTimer = setTimeout(() => setFindingVisible(true), 300);
    const panelTimer = setTimeout(() => setPanelVisible(true), 700);
    return () => {
      clearTimeout(findingTimer);
      clearTimeout(panelTimer);
    };
  }, [inView]);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, x: 40 }}
      animate={inView ? { opacity: 1, x: 0 } : {}}
      transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
      className="relative w-full bg-[#0B120F] border border-[#1E3025] rounded-2xl overflow-hidden shadow-2xl"
      style={{ minHeight: 480 }}
    >
      {/* Title Bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#050705] border-b border-[#1E3025]">
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-[#EF4444]/70" />
          <span className="w-3 h-3 rounded-full bg-[#F59E0B]/70" />
          <span className="w-3 h-3 rounded-full bg-[#4CAF50]/70" />
        </div>
        <span className="text-[11px] text-[#7E8A84] font-mono">BugZero — {sampleWorkspace.repository.fullName} · illustrative sample</span>
        <div className="flex items-center gap-1 text-[#7E8A84]">
          <Minus className="w-3 h-3" /><Square className="w-3 h-3" />
        </div>
      </div>

      <div className="flex h-full" style={{ minHeight: 440 }}>
        {/* Activity Bar */}
        <div className="w-10 bg-[#050705] border-r border-[#1E3025] flex flex-col items-center py-3 gap-4">
          {[FileCode2, GitBranch, Shield, Terminal].map((Icon, i) => (
            <Icon key={i} className={`w-4 h-4 ${i === 0 ? "text-[#2E7D32]" : "text-[#7E8A84]"}`} />
          ))}
        </div>

        {/* Sidebar File Explorer */}
        <div className="w-36 bg-[#0B120F] border-r border-[#1E3025] p-2 shrink-0">
          <div className="text-[10px] text-[#7E8A84] font-semibold uppercase tracking-widest px-1 mb-2">
            Explorer
          </div>
          {[
            { name: sampleWorkspace.repository.fullName, children: [sampleSourceName] },
          ].map((folder) => (
            <div key={folder.name}>
              <div className="flex items-center gap-1 text-[11px] text-[#AAB5AF] px-1 py-0.5">
                <FolderOpen className="w-3 h-3 text-[#F59E0B]" />
                <span>{folder.name}</span>
              </div>
              {folder.children.map((f) => (
                <div
                  key={f}
                  className={`flex items-center gap-1 text-[11px] px-3 py-0.5 rounded cursor-pointer ${
                    f === sampleSourceName
                      ? "bg-[#1E3025] text-white font-medium"
                      : "text-[#7E8A84] hover:text-[#AAB5AF]"
                  }`}
                >
                  <FileCode2 className="w-3 h-3 shrink-0" />
                  <span className="truncate">{f}</span>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Editor area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Tabs */}
          <div className="flex items-center border-b border-[#1E3025] bg-[#050705]">
            {[sampleSourceName].map((tab, i) => (
              <div
                key={tab}
                className={`flex items-center gap-1.5 px-3 py-2 text-[11px] border-r border-[#1E3025] ${
                  i === 0
                    ? "bg-[#0B120F] text-white border-t-2 border-t-[#2E7D32]"
                    : "text-[#7E8A84]"
                }`}
              >
                <FileCode2 className="w-3 h-3" />
                {tab}
                {i === 0 && (
                  <span className="w-1.5 h-1.5 rounded-full bg-[#EF4444]" title="Has findings" />
                )}
              </div>
            ))}
          </div>

          {/* Code lines */}
          <div className="flex-1 p-3 font-mono text-[11px] leading-5 overflow-hidden">
            {CODE_LINES.slice(0, visibleLines).map((line, i) => (
              <motion.div
                key={line.n}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.15 }}
                className={`flex items-start gap-3 ${
                  line.type === "danger" && findingVisible
                    ? "bg-[#EF4444]/10 rounded"
                    : ""
                }`}
              >
                <span className="text-[#7E8A84]/50 select-none w-4 text-right shrink-0">
                  {line.n}
                </span>
                <span className={LINE_COLORS[line.type] ?? "text-[#AAB5AF]"}>
                  {line.text}
                </span>
              </motion.div>
            ))}
          </div>

          {/* Bottom Terminal */}
          <div className="border-t border-[#1E3025] bg-[#050705] p-2 font-mono text-[10px]">
            <div className="text-[#7E8A84] flex items-center gap-2">
              <Terminal className="w-3 h-3" />
              <span className="text-[#2E7D32] font-bold">BugZero</span>
              <span className="text-[#7E8A84]">▸ Sample finding: {sampleSqlFinding?.finding.ruleId} · {sampleSourceFile}:{sampleSqlFinding?.occurrence?.startLine}</span>
            </div>
          </div>
        </div>

        {/* Evidence panel */}
        <AnimatePresence>
          {panelVisible && (
            <motion.div
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 176 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="border-l border-[#1E3025] bg-[#0B120F] p-3 overflow-hidden shrink-0"
              style={{ width: 176 }}
            >
              <div className="text-[10px] text-[#2E7D32] font-bold uppercase tracking-widest mb-2 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3" /> Evidence graph
              </div>
              <div className="space-y-2">
                {sampleSqlEvidence?.nodes.map((node) => (
                  <div key={node.node_key} className="rounded border border-[#1E3025] bg-[#101915] p-2 text-[10px] text-[#AAB5AF]">{node.label}</div>
                ))}
                <div className="mt-2 pt-2 border-t border-[#1E3025] text-[10px] text-[#7E8A84]">
                  Health
                  <div className="text-[#4CAF50] font-bold font-mono text-base">{sampleWorkspace.overview.latestHealth?.overall_score ?? "Unknown"} / 100</div>
                  <div className="w-full bg-[#1E3025] h-1.5 rounded-full mt-1">
                    <div className="bg-[#4CAF50] h-full rounded-full" style={{ width: `${sampleWorkspace.overview.latestHealth?.overall_score ?? 0}%` }} />
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Inline finding overlay */}
      <AnimatePresence>
        {findingVisible && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="absolute left-[190px] top-[225px] z-20 bg-[#101915] border border-[#EF4444]/50 rounded-lg shadow-xl p-2.5 max-w-[260px]"
          >
            <div className="flex items-center gap-1.5 text-[#EF4444] text-[11px] font-bold mb-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              {sampleSqlFinding?.finding.currentSeverity} · {sampleSqlFinding?.finding.ruleId.replaceAll("_", " ")}
            </div>
            <div className="text-[10px] text-[#AAB5AF]">
              Sample flow: request input reaches a dynamically constructed SQL query.
            </div>
            <div className="mt-1.5 font-mono text-[10px] space-y-0.5">
              <div className="text-[#EF4444] bg-[#EF4444]/10 px-1.5 py-0.5 rounded">
                {sampleSqlEvidence?.snapshot.authority}
              </div>
              <div className="text-[#4CAF50] bg-[#4CAF50]/10 px-1.5 py-0.5 rounded">
                {sampleSqlEvidence?.snapshot.sufficiency} · {sampleSqlEvidence?.snapshot.completeness}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Scrolling counter ────────────────────────────────────────────────────────
function Counter({ to, suffix = "" }: { to: number; suffix?: string }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true });
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!inView) return;
    let start = 0;
    const step = to / 40;
    const timer = setInterval(() => {
      start += step;
      if (start >= to) { setCount(to); clearInterval(timer); }
      else setCount(Math.floor(start));
    }, 30);
    return () => clearInterval(timer);
  }, [inView, to]);

  return <span ref={ref}>{count}{suffix}</span>;
}

// ─── Section wrapper with fade-up ────────────────────────────────────────────
function Section({
  id,
  children,
  className = "",
}: {
  id?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <motion.section
      id={id}
      ref={ref}
      initial={{ opacity: 0, y: 40 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.section>
  );
}

// ─── FAQ Item ─────────────────────────────────────────────────────────────────
function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-[#1E3025] rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-6 py-4 text-left hover:bg-[#16211B] transition-colors"
      >
        <span className="text-sm font-semibold text-white">{q}</span>
        <ChevronDown
          className={`w-4 h-4 text-[#7E8A84] transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <p className="px-6 pb-4 text-sm text-[#AAB5AF] leading-relaxed">{a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function LandingPage() {
  const { scrollY } = useScroll();
  const navBg = useTransform(scrollY, [0, 80], ["rgba(5,7,5,0)", "rgba(11,18,15,0.97)"]);
  const navBorder = useTransform(scrollY, [0, 80], ["rgba(30,48,37,0)", "rgba(30,48,37,1)"]);
  const health = landingData.overview.latestHealth;
  const score = health?.overall_score ?? "Unknown";
  const securityScore = health?.security_score ?? "Unknown";
  const qualityScore = health?.quality_score ?? "Unknown";
  const counts = landingData.overview.findingCounts;
  const coverageValue = health?.dimensions?.quality?.inputMetrics?.coveragePercent;
  const coverage = typeof coverageValue === "number" ? `${coverageValue}%` : "Unknown";
  const recentFindings = landingData.findings.slice(0, 3);
  const healthTrend = landingData.healthHistory.map(({ snapshot }) => snapshot.overall_score ?? 0).reverse();

  return (
    <div className="min-h-screen bg-[#050705] text-white overflow-x-hidden">

      {/* ── Background depth ── */}
      <div className="fixed inset-0 pointer-events-none">
        {/* Grid */}
        <div
          className="absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage:
              "linear-gradient(#1E3025 1px, transparent 1px), linear-gradient(90deg, #1E3025 1px, transparent 1px)",
            backgroundSize: "64px 64px",
          }}
        />
        {/* Radial light — top center */}
        <div
          className="absolute -top-32 left-1/2 -translate-x-1/2 w-[900px] h-[600px] rounded-full opacity-[0.12]"
          style={{ background: "radial-gradient(ellipse, #2E7D32 0%, transparent 70%)" }}
        />
      </div>

      {/* ── Sticky Navbar ── */}
      <motion.header
        style={{ backgroundColor: navBg, borderBottomColor: navBorder }}
        className="fixed top-0 left-0 right-0 z-50 h-[72px] border-b flex items-center px-6 md:px-10"
      >
        <div className="max-w-[1440px] w-full mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#2E7D32]/20 border border-[#2E7D32]/40 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-[#2E7D32]" />
            </div>
            <span className="text-lg font-bold tracking-wider">
              BUG<span className="text-[#2E7D32]">ZERO</span>
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-7 text-[13px] font-medium text-[#AAB5AF]">
            {[["#features","Features"],["#pipeline","How It Works"],["#showcase","Product"],["#tech-stack","Tech Stack"],["#faq","FAQ"]].map(([href,label]) => (
              <a key={href} href={href} className="hover:text-white transition-colors duration-150">{label}</a>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <Link href="/login" className="hidden sm:inline-flex items-center h-9 px-4 text-sm font-medium text-[#AAB5AF] hover:text-white transition-colors rounded-xl">
              Sign in
            </Link>
            <Link href="/login">
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                className="flex items-center gap-2 h-9 px-5 bg-[#2E7D32] hover:bg-[#388E3C] text-white text-sm font-semibold rounded-xl transition-colors"
              >
                Enter BugZero <ArrowRight className="w-3.5 h-3.5" />
              </motion.button>
            </Link>
          </div>
        </div>
      </motion.header>

      {/* ════════════════════════════════════════════════
          HERO — full viewport height
      ════════════════════════════════════════════════ */}
      <section className="relative min-h-screen flex items-center pt-[72px]">
        <div className="max-w-[1440px] w-full mx-auto px-6 md:px-10 py-16 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">

          {/* Left copy */}
          <motion.div
            variants={stagger(0.1)}
            initial="hidden"
            animate="show"
            className="space-y-8 relative z-10"
          >
            {/* Badge */}
            <motion.div variants={fadeUp}>
              <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[12px] font-semibold bg-[#2E7D32]/15 text-[#4CAF50] border border-[#2E7D32]/35">
                <Sparkles className="w-3.5 h-3.5" />
                Evidence-first · Repository intelligence · Deterministic risk
              </span>
              <span className="ml-3 text-[11px] text-[#7E8A84]">
                Sample repository
              </span>
            </motion.div>

            {/* Headline */}
            <motion.h1
              variants={fadeUp}
              className="text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight leading-[1.05] text-white"
            >
              Understand your code.<br />
              Investigate with{" "}
              <span className="text-[#2E7D32]">confidence.</span>
            </motion.h1>

            {/* Subtitle */}
            <motion.p variants={fadeUp} className="text-[16px] text-[#AAB5AF] leading-relaxed max-w-[480px]">
              Understand your repository, investigate findings, and track code health with evidence, risk, and analysis history in one place.
            </motion.p>

            {/* CTAs */}
            <motion.div variants={fadeUp} className="flex flex-wrap items-center gap-4">
              <Link href="/login">
                <motion.button
                  whileHover={{ scale: 1.03, boxShadow: "0 0 32px rgba(46,125,50,0.35)" }}
                  whileTap={{ scale: 0.97 }}
                  className="flex items-center gap-2.5 h-14 px-8 bg-[#2E7D32] hover:bg-[#388E3C] text-white text-[15px] font-bold rounded-xl transition-all"
                >
                  <Play className="w-4 h-4" />
                  Enter the workspace
                </motion.button>
              </Link>
              <Link href="/login">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  className="flex items-center gap-2.5 h-14 px-8 border border-[#1E3025] hover:border-[#294134] hover:bg-[#16211B] text-white text-[15px] font-semibold rounded-xl transition-all"
                >
                  Investigate a finding
                </motion.button>
              </Link>
            </motion.div>

            {/* Trust indicators */}
            <motion.div variants={fadeUp} className="flex flex-wrap items-center gap-5 pt-2 text-[13px] text-[#7E8A84]">
              {[
                { icon: ShieldCheck, text: "Evidence graph" },
                { icon: Cpu, text: "Deterministic risk" },
                { icon: TrendingUp, text: "Repository health tracking" },
              ].map(({ icon: Icon, text }) => (
                <div key={text} className="flex items-center gap-1.5">
                  <Icon className="w-3.5 h-3.5 text-[#2E7D32]" />
                  <span>{text}</span>
                </div>
              ))}
            </motion.div>
          </motion.div>

          {/* Right — VS Code workspace */}
          <div className="relative z-10">
            <VSCodeWorkspace />
          </div>
        </div>

        {/* Scroll hint */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2.5, duration: 0.8 }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-[#7E8A84]"
        >
          <span className="text-[11px] uppercase tracking-widest">Scroll to explore</span>
          <motion.div
            animate={{ y: [0, 6, 0] }}
            transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
          >
            <ChevronDown className="w-4 h-4" />
          </motion.div>
        </motion.div>
      </section>

      {/* ════════════════════════════════════════════════
          TRUST BADGES
      ════════════════════════════════════════════════ */}
      <Section className="border-y border-[#1E3025] bg-[#0B120F]/60 py-8">
        <div className="max-w-[1440px] mx-auto px-6 md:px-10">
          <div className="flex flex-wrap items-center justify-center gap-2 mb-5">
            <span className="text-[11px] font-semibold text-[#7E8A84] uppercase tracking-widest">
              Explore BugZero
            </span>
          </div>
          <motion.div
            variants={stagger(0.06)}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true }}
            className="flex flex-wrap items-center justify-center gap-3"
          >
            {["Security Analysis","Technical Risk","Code Quality","Health Tracking","Finding Evidence","Analysis History","Finding Management","Repository Overview"].map((t) => (
              <motion.span
                key={t}
                variants={fadeUp}
                className="px-4 py-2 bg-[#101915] border border-[#1E3025] rounded-xl text-[12px] text-[#AAB5AF] hover:border-[#2E7D32]/50 hover:text-white transition-colors"
              >
                {t}
              </motion.span>
            ))}
          </motion.div>
        </div>
      </Section>

      <Section id="overview" className="border-b border-[#1E3025] bg-[#0B120F] py-16 px-6 md:px-10">
        <div className="mx-auto max-w-[1440px] space-y-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-[#2E7D32]">Repository Intelligence</p>
              <h2 className="mt-2 text-3xl font-bold">Overview</h2>
              <p className="mt-2 text-sm text-[#AAB5AF]">
                {landingData.overview.repository.fullName} · {landingData.overview.repository.defaultBranch}
                {" · Sample data"}
              </p>
              <p className="mt-1 text-xs text-[#7E8A84]">
                Languages: {sampleWorkspace.repository.languages.join(" · ")}
              </p>
            </div>
            <Link href="/login" className="text-sm font-semibold text-[#4CAF50] hover:text-white">Manage repositories <ArrowRight className="ml-1 inline h-4 w-4" /></Link>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { label: "Repository health", value: score, suffix: score === "Unknown" ? "" : " / 100", color: "text-[#4CAF50]" },
              { label: "Open findings", value: counts.open, suffix: "", color: "text-white" },
              { label: "Critical / high-risk findings", value: `${counts.critical} / ${counts.highRisk}`, suffix: "", color: "text-[#EF4444]" },
              { label: "Security", value: securityScore, suffix: securityScore === "Unknown" ? "" : " / 100", color: "text-[#F59E0B]" },
              { label: "Quality", value: qualityScore, suffix: qualityScore === "Unknown" ? "" : " / 100", color: "text-[#3B82F6]" },
              { label: "Coverage", value: coverage, suffix: "", color: "text-white" },
              { label: "Analysis status", value: landingData.overview.latestRun?.status ?? "Not analyzed", suffix: "", color: "text-[#4CAF50]" },
            ].map((metric) => (
              <div key={metric.label} className="rounded-2xl border border-[#1E3025] bg-[#101915] p-4">
                <p className="text-[11px] text-[#7E8A84]">{metric.label}</p>
                <p className={`mt-2 text-xl font-bold font-mono ${metric.color}`}>{metric.value}{metric.suffix}</p>
              </div>
            ))}
          </div>
          <div className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="rounded-2xl border border-[#1E3025] bg-[#101915] p-5">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-bold">Recent findings</h3>
                <Link href="/login" className="text-xs text-[#4CAF50] hover:text-white">View all</Link>
              </div>
              <div className="space-y-2">
                {recentFindings.map(({ finding, occurrence }) => (
                  <Link key={finding.id} href="/login" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#1E3025] bg-[#0B120F] p-3 hover:border-[#2E7D32]/50">
                    <span className="flex items-center gap-3">
                      <span className="text-[10px] font-bold uppercase text-[#EF4444]">{finding.currentSeverity}</span>
                      <span className="text-sm font-semibold text-white">{finding.ruleId.replaceAll("_", " ")}</span>
                    </span>
                    <span className="text-[11px] font-mono text-[#7E8A84]">{occurrence?.filePath ?? "Location unavailable"}{typeof occurrence?.startLine === "number" ? `:${occurrence.startLine}` : ""}</span>
                  </Link>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-[#1E3025] bg-[#101915] p-5">
              <h3 className="font-bold">Recent analysis</h3>
              <p className="mt-2 text-sm text-[#AAB5AF]">Status: {landingData.overview.latestRun?.status ?? "Not analyzed"}</p>
              <p className="mt-1 text-xs text-[#7E8A84]">Latest repository health trend</p>
              <div className="mt-4 flex h-14 items-end gap-2">
                {sampleWorkspace.healthHistory.map(({ snapshot }) => snapshot.overall_score ?? 0).reverse().map((value, index) => (
                  <div key={`${index}-${value}`} title={`${value} / 100`} className="flex-1 rounded-t bg-[#2E7D32]/70" style={{ height: `${Math.max(value, 4)}%` }} />
                ))}
              </div>
              <Link href="/login" className="mt-4 inline-block text-xs text-[#4CAF50] hover:text-white">Explore repository health <ArrowRight className="ml-1 inline h-3 w-3" /></Link>
            </div>
          </div>
        </div>
      </Section>

      {/* ════════════════════════════════════════════════
          BUGZERO WORKSPACE — product concepts
      ════════════════════════════════════════════════ */}
      <Section className="py-28 px-6 md:px-10">
        <div className="max-w-[1440px] mx-auto space-y-16">
          <FadeIn className="text-center space-y-4 max-w-2xl mx-auto">
            <p className="text-[12px] font-semibold text-[#2E7D32] uppercase tracking-widest">Repository Intelligence</p>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight">
              Context for every investigation.
            </h2>
            <p className="text-[15px] text-[#AAB5AF]">
              Connect the repository, analysis, findings, evidence, risk, and health in one BugZero workspace.
            </p>
          </FadeIn>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {[
              {
                icon: Lock, color: "text-[#EF4444]", glow: "bg-[#EF4444]/5 border-[#EF4444]/20",
                title: "Repository context",
                body: "Start with a repository, branch, and the analysis history associated with its code.",
              },
              {
                icon: Zap, color: "text-[#F59E0B]", glow: "bg-[#F59E0B]/5 border-[#F59E0B]/20",
                title: "Analysis status",
                body: "Follow analysis as it progresses through the stages available to the repository.",
              },
              {
                icon: Code2, color: "text-[#3B82F6]", glow: "bg-[#3B82F6]/5 border-[#3B82F6]/20",
                title: "Unified code signals",
                body: "Repository findings, evidence, risk, and health are easier to investigate when they share one workspace.",
              },
              {
                icon: BarChart3, color: "text-[#2E7D32]", glow: "bg-[#2E7D32]/5 border-[#2E7D32]/20",
                title: "Health over time",
                body: "Review assessed dimensions and recorded health snapshots without inventing unknown metrics.",
              },
            ].map((card, i) => {
              const Icon = card.icon;
              return (
                <FadeIn key={card.title} delay={i * 0.08}>
                  <motion.div
                    whileHover={{ y: -4 }}
                    transition={{ duration: 0.2 }}
                    className={`p-6 border rounded-2xl space-y-3 h-full ${card.glow} hover:border-[#294134] transition-colors`}
                  >
                    <div className={`w-10 h-10 rounded-xl border ${card.glow} flex items-center justify-center`}>
                      <Icon className={`w-5 h-5 ${card.color}`} />
                    </div>
                    <h3 className="text-lg font-bold">{card.title}</h3>
                    <p className="text-[14px] text-[#AAB5AF] leading-relaxed">{card.body}</p>
                  </motion.div>
                </FadeIn>
              );
            })}
          </div>
        </div>
      </Section>

      {/* ════════════════════════════════════════════════
          ANALYSIS PIPELINE — connected horizontal flow
      ════════════════════════════════════════════════ */}
      <Section id="pipeline" className="py-28 px-6 md:px-10 bg-[#0B120F] border-y border-[#1E3025]">
        <div className="max-w-[1440px] mx-auto space-y-16">
          <FadeIn className="text-center space-y-4">
            <p className="text-[12px] font-semibold text-[#2E7D32] uppercase tracking-widest">From repository to insight</p>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight">The BugZero analysis pipeline</h2>
            <p className="text-[15px] text-[#AAB5AF] max-w-xl mx-auto">
              Follow repository analysis through parsing, intelligence, findings, evidence, risk, and health.
            </p>
          </FadeIn>

          <div className="relative">
            {/* Connecting line */}
            <div className="hidden md:block absolute top-8 left-[10%] right-[10%] h-[2px] bg-gradient-to-r from-transparent via-[#2E7D32]/40 to-transparent" />

            <motion.div
              variants={stagger(0.12)}
              initial="hidden"
              whileInView="show"
              viewport={{ once: true, margin: "-60px" }}
              className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4 relative"
            >
              {[
                { step: "01", title: "Queued", desc: "Repository analysis enters the workspace.", icon: FolderOpen, color: "text-[#3B82F6]" },
                { step: "02", title: "Parsing", desc: "Source files are parsed into code representations.", icon: Code2, color: "text-[#F59E0B]" },
                { step: "03", title: "Repository Intelligence", desc: "Code entities and relationships provide analysis context.", icon: Cpu, color: "text-[#2E7D32]" },
                { step: "04", title: "Findings & Evidence", desc: "Analyzers report findings with supporting evidence.", icon: ShieldCheck, color: "text-[#AAB5AF]" },
                { step: "05", title: "Risk & Health", desc: "Review risk assessments and repository health.", icon: FileCheck, color: "text-[#4CAF50]" },
              ].map((p, i) => {
                const Icon = p.icon;
                return (
                  <motion.div
                    key={p.step}
                    variants={fadeUp}
                    className="relative bg-[#101915] border border-[#1E3025] rounded-2xl p-5 space-y-3 hover:border-[#2E7D32]/50 transition-colors group"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono font-bold text-[#7E8A84]">{p.step}</span>
                      <Icon className={`w-4 h-4 ${p.color} group-hover:scale-110 transition-transform`} />
                    </div>
                    <h4 className="text-[14px] font-bold">{p.title}</h4>
                    <p className="text-[12px] text-[#7E8A84] leading-relaxed">{p.desc}</p>
                    {i < 4 && (
                      <div className="hidden md:block absolute -right-3 top-8 z-10 w-6 h-6 rounded-full bg-[#0B120F] border border-[#2E7D32]/30 flex items-center justify-center">
                        <ArrowRight className="w-3 h-3 text-[#2E7D32]" />
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </motion.div>
          </div>
        </div>
      </Section>

      {/* ════════════════════════════════════════════════
          INTERACTIVE PRODUCT SHOWCASE — bento grid
      ════════════════════════════════════════════════ */}
      <Section id="showcase" className="py-28 px-6 md:px-10">
        <div className="max-w-[1440px] mx-auto space-y-16">
          <FadeIn className="text-center space-y-4">
            <p className="text-[12px] font-semibold text-[#2E7D32] uppercase tracking-widest">Product Preview</p>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight">Everything you need, nothing you don&apos;t</h2>
          </FadeIn>

          {/* Bento grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 auto-rows-auto">

            {/* Big: Repository Health */}
            <FadeIn className="md:col-span-2" delay={0}>
              <motion.div
                whileHover={{ y: -3 }}
                className="bg-[#101915] border border-[#1E3025] rounded-2xl p-6 space-y-4 h-full hover:border-[#294134] transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[11px] font-semibold text-[#7E8A84] uppercase tracking-wider mb-1">Repository Health</p>
                    <h3 className="text-lg font-bold">{landingData.overview.repository.fullName}</h3>
                  </div>
                  <span className="px-3 py-1 bg-[#4CAF50]/15 border border-[#4CAF50]/30 text-[#4CAF50] text-[12px] font-mono font-bold rounded-full">
                    {score}{score === "Unknown" ? "" : " / 100"}
                  </span>
                </div>
                {/* Inline mini chart */}
                <div className="flex items-end gap-1 h-16">
                  {(healthTrend.length ? healthTrend : [0]).map((v, i) => (
                    <motion.div
                      key={i}
                      initial={{ height: 0 }}
                      whileInView={{ height: `${(v / 100) * 64}px` }}
                      viewport={{ once: true }}
                      transition={{ delay: i * 0.07, duration: 0.4, ease: "easeOut" }}
                      className="flex-1 rounded-t bg-[#2E7D32]/50 hover:bg-[#2E7D32] transition-colors"
                    />
                  ))}
                </div>
                <div className="flex justify-between text-[10px] text-[#7E8A84] font-mono">
                  {landingData.healthHistory.slice().reverse().map(({ snapshot }) => (
                    <span key={snapshot.id}>{new Date(snapshot.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-3 pt-2 border-t border-[#1E3025]">
                  {[
                    ["Quality", qualityScore, "text-[#3B82F6]"],
                    ["Security", securityScore, "text-[#F59E0B]"],
                    ["Open Findings", String(counts.open), "text-[#EF4444]"],
                  ].map(([l,v,c]) => (
                    <div key={l} className="bg-[#0B120F] rounded-xl p-3">
                      <span className="text-[10px] text-[#7E8A84] block">{l}</span>
                      <span className={`text-lg font-bold font-mono ${c}`}>{v}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            </FadeIn>

            {/* Tall: finding card */}
            <FadeIn delay={0.1}>
              <motion.div
                whileHover={{ y: -3 }}
                className="bg-[#101915] border border-[#EF4444]/25 rounded-2xl p-5 space-y-4 hover:border-[#EF4444]/50 transition-colors h-full"
              >
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-1 bg-[#EF4444]/15 border border-[#EF4444]/30 text-[#EF4444] text-[11px] font-bold rounded-full uppercase">{recentFindings[0]?.finding.currentSeverity ?? "Finding"}</span>
                  <span className="text-[11px] font-mono text-[#7E8A84]">Confidence {recentFindings[0]?.finding.currentConfidence ?? "Unknown"}</span>
                </div>
                <div>
                  <h4 className="text-[14px] font-bold">{recentFindings[0]?.finding.ruleId.replaceAll("_", " ") ?? "No findings"}</h4>
                  <p className="text-[11px] text-[#7E8A84] font-mono mt-1">
                    {recentFindings[0]?.occurrence?.filePath ?? "Location unavailable"}
                    {typeof recentFindings[0]?.occurrence?.startLine === "number" ? `:${recentFindings[0].occurrence.startLine}` : ""}
                  </p>
                </div>
                <div className="bg-[#050705] rounded-xl p-3 font-mono text-[11px] space-y-1 border border-[#1E3025]">
                  <div className="text-[#AAB5AF] px-2 py-1 rounded">
                    Technical risk: {recentFindings[0]?.finding.currentRisk ?? "Unknown"}
                  </div>
                </div>
                <div className="bg-[#0B120F] border border-[#1E3025] rounded-xl p-3 text-[11px] text-[#AAB5AF] space-y-1">
                  <p className="font-semibold text-white text-[12px]">Investigation</p>
                  <p>Open the finding to review its status, source location, evidence, and risk assessment.</p>
                </div>
                <div className="pt-2">
                  <div className="w-full bg-[#0B120F] rounded-full h-1.5 border border-[#1E3025]">
                    <motion.div
                      initial={{ width: 0 }}
                      whileInView={{ width: `${recentFindings[0]?.finding.currentRisk ?? 0}%` }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.7, ease: "easeOut" }}
                      className="bg-[#EF4444] h-full rounded-full"
                    />
                  </div>
                  <p className="text-[10px] text-[#7E8A84] mt-1 font-mono">Technical risk · {recentFindings[0]?.finding.currentRisk ?? "Unknown"}</p>
                </div>
              </motion.div>
            </FadeIn>

            {/* Wide: sample code viewer */}
            <FadeIn className="md:col-span-2" delay={0.15}>
              <motion.div
                whileHover={{ y: -3 }}
                className="bg-[#101915] border border-[#1E3025] rounded-2xl overflow-hidden hover:border-[#294134] transition-colors h-full"
              >
                <div className="px-5 py-3 bg-[#0B120F] border-b border-[#1E3025] flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[12px] font-semibold text-[#AAB5AF]">
                    <FileCode2 className="w-3.5 h-3.5 text-[#2E7D32]" />
                    Sample code flow — {sampleSourceFile}
                  </div>
                  <div className="flex items-center gap-3 text-[11px]">
                    <span className="text-[#7E8A84]">Illustrative sample</span>
                  </div>
                </div>
                <div className="p-5 font-mono text-[12px] space-y-1.5">
                  {sampleWorkspace.codeLines.map((line, index) => (
                    <motion.div
                      key={line.n}
                      initial={{ opacity: 0 }}
                      whileInView={{ opacity: 1 }}
                      viewport={{ once: true }}
                      transition={{ delay: index * 0.06, duration: 0.25 }}
                      className={`px-3 py-0.5 rounded ${line.type === "danger" ? "bg-[#EF4444]/10 text-[#EF4444]" : "text-[#AAB5AF]"}`}
                    >
                      {line.text}
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            </FadeIn>

            {/* Small: latest analysis */}
            <FadeIn delay={0.2}>
              <motion.div
                whileHover={{ y: -3 }}
                className="bg-[#101915] border border-[#1E3025] rounded-2xl p-5 space-y-4 hover:border-[#294134] transition-colors h-full"
              >
                <p className="text-[11px] font-semibold text-[#7E8A84] uppercase tracking-wider">Latest analysis</p>
                <div className="space-y-4">
                  <div className="text-sm font-semibold text-white">{landingData.overview.latestRun?.status ?? "Not analyzed"}</div>
                  <div className="rounded-xl border border-[#1E3025] bg-[#0B120F] p-3">
                    <p className="text-[10px] uppercase tracking-wider text-[#7E8A84]">Repository</p>
                    <p className="mt-1 truncate font-mono text-xs text-[#AAB5AF]">{landingData.overview.repository.fullName}</p>
                    <p className="mt-2 text-[10px] uppercase tracking-wider text-[#7E8A84]">Branch</p>
                    <p className="mt-1 font-mono text-xs text-[#AAB5AF]">{landingData.overview.repository.defaultBranch}</p>
                  </div>
                  <Link href="/login" className="inline-block text-xs text-[#4CAF50] hover:text-white">View analysis history <ArrowRight className="ml-1 inline h-3 w-3" /></Link>
                </div>
              </motion.div>
            </FadeIn>
          </div>
        </div>
      </Section>

      {/* ════════════════════════════════════════════════
          FEATURES — 3x2 grid with icon + hover border
      ════════════════════════════════════════════════ */}
      <Section id="features" className="py-28 px-6 md:px-10 bg-[#0B120F] border-y border-[#1E3025]">
        <div className="max-w-[1440px] mx-auto space-y-16">
          <FadeIn className="text-center space-y-4">
            <p className="text-[12px] font-semibold text-[#2E7D32] uppercase tracking-widest">Features</p>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight">
              Everything you need for repository quality
            </h2>
          </FadeIn>

          <motion.div
            variants={stagger(0.07)}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-60px" }}
            className="grid grid-cols-1 md:grid-cols-3 gap-5"
          >
            {[
              { icon: ShieldCheck, color: "text-[#2E7D32]", bg: "bg-[#2E7D32]/10 border-[#2E7D32]/20",
                title: "Security Findings",
                body: "Review analyzer findings with severity, confidence, technical risk, and source locations." },
              { icon: GitBranch, color: "text-[#AAB5AF]", bg: "bg-[#AAB5AF]/5 border-[#AAB5AF]/15",
                title: "Evidence Graphs",
                body: "Trace supported source-to-sink paths and inspect evidence authority, completeness, and sufficiency." },
              { icon: Code2, color: "text-[#3B82F6]", bg: "bg-[#3B82F6]/10 border-[#3B82F6]/20",
                title: "Repository Intelligence",
                body: "Explore parsed code entities and relationships that provide context for analysis." },
              { icon: BarChart3, color: "text-[#4CAF50]", bg: "bg-[#4CAF50]/10 border-[#4CAF50]/20",
                title: "Repository Health",
                body: "Review assessed health dimensions and their available history; unassessed dimensions remain unknown." },
              { icon: FileCheck, color: "text-[#F59E0B]", bg: "bg-[#F59E0B]/10 border-[#F59E0B]/20",
                title: "Analysis History",
                body: "Track analysis status and findings associated with repository commits." },
              { icon: Lock, color: "text-[#EF4444]", bg: "bg-[#EF4444]/10 border-[#EF4444]/20",
                title: "Evidence-led Risk",
                body: "Inspect technical risk assessments alongside the evidence and confidence available for a finding." },
            ].map((f) => {
              const Icon = f.icon;
              return (
                <motion.div
                  key={f.title}
                  variants={fadeUp}
                  whileHover={{ y: -4, borderColor: "#294134" }}
                  className="bg-[#101915] border border-[#1E3025] rounded-2xl p-6 space-y-4 transition-all cursor-default"
                >
                  <div className={`w-10 h-10 border rounded-xl flex items-center justify-center ${f.bg}`}>
                    <Icon className={`w-5 h-5 ${f.color}`} />
                  </div>
                  <h3 className="text-[16px] font-bold">{f.title}</h3>
                  <p className="text-[13px] text-[#AAB5AF] leading-relaxed">{f.body}</p>
                </motion.div>
              );
            })}
          </motion.div>
        </div>
      </Section>

      {/* ════════════════════════════════════════════════
          STATS COUNTERS
      ════════════════════════════════════════════════ */}
      <Section className="py-20 px-6 md:px-10">
        <div className="max-w-[1440px] mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
            {[
              { value: String(counts.open), label: "Open findings", color: "text-[#EF4444]" },
              { value: `${counts.critical} / ${counts.highRisk}`, label: "Critical / high-risk findings", color: "text-[#F59E0B]" },
              { value: String(score), label: "Repository health / 100", color: "text-[#4CAF50]" },
              { value: String(coverage), label: "Coverage", color: "text-[#3B82F6]" },
            ].map((stat) => (
              <FadeIn key={stat.label}>
                <div className="bg-[#101915] border border-[#1E3025] rounded-2xl p-6 text-center">
                  <p className={`text-4xl font-bold font-mono ${stat.color}`}>
                    {stat.value}
                  </p>
                  <p className="text-[12px] text-[#7E8A84] mt-2 leading-snug">{stat.label}</p>
                </div>
              </FadeIn>
            ))}
          </div>
        </div>
      </Section>

      {/* ════════════════════════════════════════════════
          HOW BUGZERO WORKS — timeline / vertical steps
      ════════════════════════════════════════════════ */}
      <Section className="py-28 px-6 md:px-10 bg-[#0B120F] border-y border-[#1E3025]">
        <div className="max-w-[1440px] mx-auto space-y-16">
          <FadeIn className="text-center space-y-4">
            <p className="text-[12px] font-semibold text-[#2E7D32] uppercase tracking-widest">How It Works</p>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight">From repository to actionable insight</h2>
          </FadeIn>

          <div className="relative max-w-3xl mx-auto">
            {/* Vertical line */}
            <div className="absolute left-[27px] top-4 bottom-4 w-[2px] bg-[#1E3025]" />
            <div className="space-y-8">
              {[
                { n: "01", title: "Choose a repository", body: "Open an available repository and review its current branch and analysis context.", color: "bg-[#3B82F6]" },
                { n: "02", title: "Analyze", body: "Start an analysis and follow its queued, parsing, and analysis stages.", color: "bg-[#F59E0B]" },
                { n: "03", title: "Explore findings", body: "Review finding status, severity, confidence, technical risk, and source location.", color: "bg-[#2E7D32]" },
                { n: "04", title: "Inspect evidence", body: "Open supported evidence paths and see whether a flow is complete and sufficient.", color: "bg-[#AAB5AF]" },
                { n: "05", title: "Track health", body: "Review health dimensions, analysis history, and available repository trends.", color: "bg-[#4CAF50]" },
              ].map((step, i) => (
                <FadeIn key={step.n} delay={i * 0.1} className="relative flex items-start gap-6">
                  <div className={`w-14 h-14 rounded-full ${step.color} flex items-center justify-center text-white font-bold text-sm shrink-0 z-10 shadow-lg`}>
                    {step.n}
                  </div>
                  <div className="bg-[#101915] border border-[#1E3025] rounded-2xl p-5 flex-1 hover:border-[#294134] transition-colors">
                    <h4 className="text-[15px] font-bold mb-1">{step.title}</h4>
                    <p className="text-[13px] text-[#AAB5AF] leading-relaxed">{step.body}</p>
                  </div>
                </FadeIn>
              ))}
            </div>
          </div>
        </div>
      </Section>

      {/* ════════════════════════════════════════════════
          PRODUCT CONCEPTS
      ════════════════════════════════════════════════ */}
      <Section className="py-28 px-6 md:px-10">
        <div className="max-w-[1440px] mx-auto space-y-16">
          <FadeIn className="text-center space-y-4">
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight">One workspace for repository investigation</h2>
          </FadeIn>

          <FadeIn>
            <div className="overflow-x-auto rounded-2xl border border-[#1E3025]">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="bg-[#0B120F] border-b border-[#1E3025]">
                    <th className="px-6 py-4 font-semibold text-[#7E8A84] uppercase text-[11px] tracking-wider">Product area</th>
                    <th className="px-6 py-4 font-semibold text-[#2E7D32] uppercase text-[11px] tracking-wider">What you can inspect</th>
                    <th className="px-6 py-4 font-semibold text-[#7E8A84] uppercase text-[11px] tracking-wider">Workspace</th>
                  </tr>
                </thead>
                <tbody className="bg-[#101915] divide-y divide-[#1E3025]">
                  {[
                    ["Repositories", "Provider, branch, languages, and analysis context", "Repository list"],
                    ["Analysis", "Run status and available progress stages", "Analysis history"],
                    ["Findings", "Severity, confidence, risk, and source location", "Finding detail"],
                    ["Evidence", "Authority, completeness, sufficiency, and graph paths", "Evidence graph"],
                    ["Health", "Assessed dimensions and available snapshots", "Health history"],
                    ["Risk", "Technical risk and its assessment factors", "Risk assessment"],
                  ].map(([feat, bugzero, manual], i) => (
                    <motion.tr
                      key={feat}
                      initial={{ opacity: 0 }}
                      whileInView={{ opacity: 1 }}
                      viewport={{ once: true }}
                      transition={{ delay: i * 0.05 }}
                      className="hover:bg-[#16211B] transition-colors"
                    >
                      <td className="px-6 py-4 font-semibold text-white">{feat}</td>
                      <td className="px-6 py-4">
                        <span className="flex items-center gap-2 text-[#4CAF50] font-medium">
                          <CheckCircle2 className="w-4 h-4 shrink-0" /> {bugzero}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="flex items-center gap-2 text-[#7E8A84]">
                          <ArrowRight className="w-4 h-4 shrink-0" /> {manual}
                        </span>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          </FadeIn>
        </div>
      </Section>

      {/* ════════════════════════════════════════════════
          PRODUCT AREAS
      ════════════════════════════════════════════════ */}
      <Section id="tech-stack" className="py-28 px-6 md:px-10 bg-[#0B120F] border-y border-[#1E3025]">
        <div className="max-w-[1440px] mx-auto space-y-16">
          <FadeIn className="text-center space-y-4">
            <p className="text-[12px] font-semibold text-[#2E7D32] uppercase tracking-widest">BugZero workspace</p>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight">A clear path from code to context</h2>
          </FadeIn>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
            {[
              { layer: "Repository", color: "text-[#3B82F6]", border: "border-[#3B82F6]/20", bg: "bg-[#3B82F6]/5",
                items: ["Repository overview", "Branch and commit context", "Language metadata", "Analysis history", "Repository health"] },
              { layer: "Analysis", color: "text-[#2E7D32]", border: "border-[#2E7D32]/20", bg: "bg-[#2E7D32]/5",
                items: ["Queued status", "Parsing stage", "Repository intelligence", "Findings", "Completion status"] },
              { layer: "Findings", color: "text-[#F59E0B]", border: "border-[#F59E0B]/20", bg: "bg-[#F59E0B]/5",
                items: ["Rule and severity", "Source location", "Confidence", "Technical risk", "Finding status"] },
              { layer: "Evidence", color: "text-[#AAB5AF]", border: "border-[#AAB5AF]/20", bg: "bg-[#AAB5AF]/5",
                items: ["Evidence graph", "Authority", "Completeness", "Sufficiency", "Path diagnostics"] },
            ].map((stack) => (
              <FadeIn key={stack.layer}>
                <motion.div
                  whileHover={{ y: -3 }}
                  className={`bg-[#101915] border ${stack.border} rounded-2xl p-6 space-y-4 h-full ${stack.bg} hover:border-opacity-50 transition-all`}
                >
                  <h4 className={`text-[13px] font-bold uppercase tracking-wider ${stack.color}`}>{stack.layer}</h4>
                  <ul className="space-y-2">
                    {stack.items.map((item) => (
                      <li key={item} className="flex items-center gap-2 text-[13px] text-[#AAB5AF]">
                        <span className={`w-1.5 h-1.5 rounded-full bg-current ${stack.color} shrink-0`} />
                        {item}
                      </li>
                    ))}
                  </ul>
                </motion.div>
              </FadeIn>
            ))}
          </div>
        </div>
      </Section>

      {/* ════════════════════════════════════════════════
          FAQ — expandable accordion
      ════════════════════════════════════════════════ */}
      <Section id="faq" className="py-28 px-6 md:px-10">
        <div className="max-w-[1440px] mx-auto space-y-16">
          <FadeIn className="text-center space-y-4">
            <p className="text-[12px] font-semibold text-[#2E7D32] uppercase tracking-widest">FAQ</p>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight">Frequently asked questions</h2>
          </FadeIn>

          <div className="max-w-3xl mx-auto space-y-3">
            {[
              { q: "What can I explore in BugZero?",
                a: "Repositories, analysis runs, findings, evidence graphs, technical risk assessments, and repository health are organized in one workspace." },
              { q: "What does a finding include?",
                a: "Available finding details can include its rule, severity, confidence, status, source location, evidence, and technical risk." },
              { q: "What does evidence sufficiency mean?",
                a: "Evidence records expose their authority, provenance, sufficiency, completeness, paths, and diagnostics. Incomplete or unresolved flows are not presented as sufficient." },
              { q: "Why do some health dimensions say Unknown?",
                a: "A dimension is shown as unknown when an assessment is not available; BugZero does not substitute a made-up score." },
              { q: "What is Sample data?",
                a: "When a live repository is not available, BugZero keeps the workspace usable with a clearly labeled demonstration repository and sample records." },
            ].map((faq) => (
              <FadeIn key={faq.q}>
                <FAQItem q={faq.q} a={faq.a} />
              </FadeIn>
            ))}
          </div>
        </div>
      </Section>

      {/* ════════════════════════════════════════════════
          FINAL CTA
      ════════════════════════════════════════════════ */}
      <Section className="py-32 px-6 md:px-10">
        <div className="max-w-[1440px] mx-auto">
          <FadeIn>
            <div className="relative overflow-hidden bg-[#101915] border border-[#2E7D32]/30 rounded-3xl p-12 md:p-20 text-center space-y-8">
              {/* Background glow */}
              <div
                className="absolute inset-0 opacity-[0.07]"
                style={{ background: "radial-gradient(ellipse at center, #2E7D32 0%, transparent 70%)" }}
              />

              <div className="relative space-y-5 max-w-2xl mx-auto">
                <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[12px] font-semibold bg-[#2E7D32]/15 text-[#4CAF50] border border-[#2E7D32]/35">
                  <Sparkles className="w-3.5 h-3.5" /> Your repository intelligence workspace
                </span>
                <h2 className="text-4xl md:text-5xl font-bold tracking-tight">
                  Understand your repository
                </h2>
                <p className="text-[16px] text-[#AAB5AF] leading-relaxed">
                  Investigate findings, follow evidence, and track repository health in BugZero.
                </p>
              </div>

              <div className="relative flex flex-col sm:flex-row items-center justify-center gap-4">
                <Link href="/login">
                  <motion.button
                    whileHover={{ scale: 1.03, boxShadow: "0 0 40px rgba(46,125,50,0.4)" }}
                    whileTap={{ scale: 0.97 }}
                    className="flex items-center gap-2.5 h-14 px-10 bg-[#2E7D32] hover:bg-[#388E3C] text-white text-[15px] font-bold rounded-xl transition-all"
                  >
                    <Play className="w-4 h-4" />
                    Enter the workspace
                    <ArrowRight className="w-4 h-4" />
                  </motion.button>
                </Link>
                <Link href="/login">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.97 }}
                    className="flex items-center gap-2.5 h-14 px-8 border border-[#1E3025] hover:border-[#294134] hover:bg-[#16211B] text-white text-[15px] font-semibold rounded-xl transition-all"
                  >
                    <TrendingUp className="w-4 h-4" />
                    Explore repository health
                  </motion.button>
                </Link>
              </div>
            </div>
          </FadeIn>
        </div>
      </Section>

      {/* ════════════════════════════════════════════════
          FOOTER
      ════════════════════════════════════════════════ */}
      <footer className="border-t border-[#1E3025] bg-[#0B120F] px-6 md:px-10 py-10">
        <div className="max-w-[1440px] mx-auto flex flex-col md:flex-row items-center justify-between gap-6 text-[12px] text-[#7E8A84]">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#2E7D32]" />
            <span className="font-bold text-white">BugZero</span>
            <span>— Repository Intelligence</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-6">
            <Link href="/login" className="hover:text-white transition-colors">Repositories</Link>
            <Link href="/login" className="hover:text-white transition-colors">Findings</Link>
            <Link href="/login" className="hover:text-white transition-colors">Health</Link>
            <Link href="/login" className="hover:text-white transition-colors">Analysis history</Link>
          </div>
          <span>© 2026 BugZero. All rights reserved.</span>
        </div>
      </footer>

    </div>
  );
}
